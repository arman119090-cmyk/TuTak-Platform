import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { RateLimiter } from '../../common/rate-limit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ENV, Env } from '../../config/env';
import { requestContext } from '../../common/request-context';
import { SmsGatewayPort } from './sms-gateway.port';

export interface OtpChallengeIssued {
  readonly challengeId: string;
  readonly expiresAt: Date;
  readonly resendAfterSeconds: number;
  readonly codeLength: number;
}

/**
 * Phone verification.
 *
 * The threat here is not a clever attacker so much as an expensive one: each SMS
 * costs money, and an unthrottled endpoint is both an account-takeover surface
 * and a way to spend someone's SMS budget overnight. Hence limits on three
 * independent dimensions — per phone, per IP, and a cooldown between sends —
 * and a hard attempt cap per challenge.
 *
 * A code is never stored, logged, or returned; only a scrypt hash of it is kept.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
    private readonly sms: SmsGatewayPort,
    private readonly logger: AppLogger,
  ) {}

  async request(phone: string, deviceId: string, locale: string): Promise<OtpChallengeIssued> {
    const ip = requestContext.get()?.ip ?? 'unknown';

    await this.limiter.enforce(`otp:phone:${phone}`, this.env.OTP_MAX_PER_PHONE_PER_HOUR, 3600);
    await this.limiter.enforce(`otp:ip:${ip}`, this.env.OTP_MAX_PER_IP_PER_HOUR, 3600);

    const cooldownUntil = new Date(
      this.clock.nowMs() - this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
    );
    const recent = await this.prisma.otpChallenge.findFirst({
      where: { phone, createdAt: { gt: cooldownUntil } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent) {
      const waitSeconds = Math.max(
        1,
        Math.ceil(
          (recent.createdAt.getTime() + this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000 -
            this.clock.nowMs()) /
            1000,
        ),
      );
      throw new AppError('OTP_REQUEST_TOO_SOON', 'A code was sent a moment ago', {
        retryAfterSeconds: waitSeconds,
      });
    }

    const code = this.crypto.generateOtpCode(this.env.OTP_LENGTH);
    const expiresAt = this.clock.plusSeconds(this.env.OTP_TTL_SECONDS);

    const challenge = await this.prisma.otpChallenge.create({
      data: {
        phone,
        codeHash: this.crypto.hashSecret(code),
        deviceId,
        maxAttempts: this.env.OTP_MAX_ATTEMPTS,
        // Stamped from the injected clock, not the database's now(): the
        // cooldown below compares against this column, and two time sources
        // that can drift apart would make the cooldown silently ineffective.
        createdAt: this.clock.now(),
        expiresAt,
        ip: ip === 'unknown' ? null : ip,
      },
      select: { id: true },
    });

    const delivered = await this.sms.sendOtp({ phone, code, locale });
    if (!delivered) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { deliveryFailed: true },
      });
      this.logger.warning('OTP delivery failed', { challengeId: challenge.id });
    }

    return {
      challengeId: challenge.id,
      expiresAt,
      resendAfterSeconds: this.env.OTP_RESEND_COOLDOWN_SECONDS,
      codeLength: this.env.OTP_LENGTH,
    };
  }

  /**
   * Verifies a code and consumes the challenge.
   *
   * The attempt counter is incremented *before* the code is compared, so a
   * crash, a disconnect or a race cannot be used to get a free guess. The
   * challenge is single-use: a correct code consumes it, and a consumed
   * challenge is not reusable even within its TTL.
   */
  async verify(challengeId: string, code: string, deviceId: string): Promise<string> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) {
      throw new AppError('OTP_INVALID', 'Unknown challenge');
    }
    if (challenge.consumedAt) {
      throw new AppError('OTP_INVALID', 'This code has already been used');
    }
    if (challenge.expiresAt.getTime() <= this.clock.nowMs()) {
      throw new AppError('OTP_EXPIRED', 'This code has expired');
    }
    if (challenge.deviceId !== deviceId) {
      // The code was issued to a different installation. Treating this as a
      // plain mismatch avoids telling an attacker which half they got right.
      await this.bumpAttempts(challengeId);
      throw new AppError('OTP_INVALID', 'That code is not valid for this device');
    }

    const attempts = await this.bumpAttempts(challengeId);
    if (attempts > challenge.maxAttempts) {
      await this.prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { consumedAt: this.clock.now() },
      });
      throw new AppError('OTP_TOO_MANY_ATTEMPTS', 'Too many attempts');
    }

    if (!this.crypto.verifySecret(code, challenge.codeHash)) {
      throw new AppError('OTP_INVALID', 'That code is not right', {
        attemptsRemaining: Math.max(0, challenge.maxAttempts - attempts),
      });
    }

    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: this.clock.now() },
    });
    await this.limiter.reset(`otp:phone:${challenge.phone}`);

    return challenge.phone;
  }

  private async bumpAttempts(challengeId: string): Promise<number> {
    const updated = await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return updated.attempts;
  }

  /** Housekeeping: expired challenges carry a code hash and a phone number. */
  async purgeExpired(olderThanSeconds = 86_400): Promise<number> {
    const result = await this.prisma.otpChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(this.clock.nowMs() - olderThanSeconds * 1000) } },
    });
    return result.count;
  }
}
