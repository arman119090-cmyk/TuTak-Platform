import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthOtpPurpose } from '@prisma/client';
import { generateNumericCode, sha256Hex } from '../../common/utils/crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../../infrastructure/sms/sms-provider.interface';
import { OtpIpRateLimitService } from './otp-ip-rate-limit.service';

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

/** Same account-level ceilings PhoneVerificationService and PasswordService use. */
const MAX_CODES_PER_WINDOW = 5;
const MAX_ATTEMPTS_PER_WINDOW = 15;
const WINDOW_MS = 60 * 60_000;

/**
 * Issues and consumes the OTP challenge that phone-first registration and
 * login are built on. Only the challenge lifecycle lives here — creating the
 * user, issuing tokens and everything after a code is confirmed stays in
 * `AuthService`, the same split `PhoneVerificationService` and
 * `PasswordService` already use.
 *
 * Phone-keyed rather than userId-keyed: REGISTER has no User row yet, so
 * this cannot reuse `PhoneVerificationToken`. `AuthOtpPurpose` keeps a
 * REGISTER code from being replayable as a LOGIN code on the same number.
 */
@Injectable()
export class AuthOtpService {
  private readonly logger = new Logger(AuthOtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipRateLimit: OtpIpRateLimitService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async requestCode(phone: string, purpose: AuthOtpPurpose): Promise<{ success: true }> {
    const issued = await this.prisma.authOtpToken.count({
      where: { phone, purpose, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    });
    if (issued >= MAX_CODES_PER_WINDOW) {
      throw new BadRequestException('Too many codes requested. Try again later.');
    }

    const code = generateNumericCode(6);

    await this.prisma.$transaction(async (tx) => {
      // One live challenge at a time per phone+purpose; older codes stop
      // being guessable the moment a new one is issued.
      await tx.authOtpToken.updateMany({
        where: { phone, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.authOtpToken.create({
        data: { phone, purpose, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
      });
    });

    await this.sms
      .send({ to: phone, body: `TuTak: your verification code is ${code}`, templateParams: [code] })
      .catch((err: Error) => this.logger.error(`Could not deliver OTP to ${phone}: ${err.message}`));

    // SMS is the only channel a live code travels on.
    //
    // A LOGIN code used to be copied into a `Notification` as well, with the
    // code itself in `params`. `NotificationsService.send` persists that
    // column, so every issued code was written to the database in plaintext
    // and served back, still live, by `GET /notifications/me` — to anyone
    // holding an access token for the account, and to anyone with read
    // access to the table. A second factor readable through the first factor
    // is not a second factor. The notification is gone rather than redacted:
    // its i18n keys were never added, so it rendered as a raw key, and the
    // code it existed to carry is exactly what must not be stored.
    return { success: true };
  }

  /** Validates and consumes a code. Throws if wrong, expired, or already used. */
  async consumeCode(
    phone: string,
    purpose: AuthOtpPurpose,
    code: string,
    ipAddress?: string,
  ): Promise<void> {
    const invalid = new UnauthorizedException('Code is invalid or has expired');

    // Guessing spread thinly across many numbers costs the attacker nothing
    // under the phone-keyed ceiling below; it costs them this budget.
    await this.ipRateLimit.consume(ipAddress, 'verify');

    const spent = await this.prisma.authOtpToken.aggregate({
      where: { phone, purpose, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
      _sum: { attempts: true },
    });
    if ((spent._sum.attempts ?? 0) >= MAX_ATTEMPTS_PER_WINDOW) throw invalid;

    const challenge = await this.prisma.authOtpToken.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw invalid;

    if (challenge.codeHash !== sha256Hex(code)) {
      const attempts = challenge.attempts + 1;
      await this.prisma.authOtpToken.update({
        where: { id: challenge.id },
        data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
      });
      throw invalid;
    }

    // Consume conditionally: two requests racing the same code must not both
    // pass and both go on to create/authenticate.
    const consumed = await this.prisma.authOtpToken.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;
  }
}
