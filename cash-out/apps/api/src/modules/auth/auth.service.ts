import { Injectable } from '@nestjs/common';
import { AuthTokens, RequestOtpDto, VerifyOtpDto } from '@cashout/contracts';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { OtpChallengeIssued, OtpService } from './otp.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async requestOtp(dto: RequestOtpDto): Promise<OtpChallengeIssued> {
    return this.otp.request(dto.phone, dto.deviceId, dto.locale);
  }

  /**
   * Verifying a code both authenticates and, for a new number, creates the
   * account. There is no separate registration step: a driver has one identity,
   * their phone number, and Yandex linkage happens afterwards.
   */
  async verifyOtp(dto: VerifyOtpDto): Promise<AuthTokens & { isNewUser: boolean }> {
    const phone = await this.otp.verify(dto.challengeId, dto.code, dto.deviceId);
    const context = requestContext.get();

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing?.status === 'SUSPENDED') {
      throw new AppError('FORBIDDEN', 'This account is suspended');
    }

    const user =
      existing ??
      (await this.prisma.user.create({
        data: { phone, driver: { create: {} } },
      }));

    const device = await this.prisma.device.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: dto.deviceId } },
      create: {
        userId: user.id,
        deviceId: dto.deviceId,
        name: dto.deviceName ?? null,
        platform: dto.platform ?? null,
      },
      update: { lastSeenAt: this.clock.now(), name: dto.deviceName ?? undefined },
    });

    if (device.blocked) {
      throw new AppError('FORBIDDEN', 'This device is blocked');
    }

    const issued = await this.tokens.issue({
      userId: user.id,
      deviceRowId: device.id,
      deviceId: dto.deviceId,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    await this.audit.record({
      action: existing ? 'auth.signed_in' : 'auth.registered',
      subjectType: 'user',
      subjectId: user.id,
      actorType: 'DRIVER',
      actorId: user.id,
      after: { deviceId: dto.deviceId },
    });

    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      refreshExpiresIn: issued.refreshExpiresIn,
      isNewUser: !existing,
    };
  }

  async refresh(refreshToken: string, deviceId: string): Promise<AuthTokens> {
    return this.tokens.refresh(refreshToken, deviceId);
  }

  async signOut(sessionId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'user_signed_out');
  }

  async signOutEverywhere(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId, 'user_signed_out_everywhere');
    await this.audit.record({
      action: 'auth.signed_out_everywhere',
      subjectType: 'user',
      subjectId: userId,
      actorType: 'DRIVER',
      actorId: userId,
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: this.clock.now() } },
      include: { device: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      deviceId: session.device.deviceId,
      deviceName: session.device.name,
      platform: session.device.platform,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      current: session.id === currentSessionId,
    }));
  }
}
