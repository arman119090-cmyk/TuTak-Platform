import { Inject, Injectable } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { ENV, Env } from '../../config/env';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { RateLimiter } from '../../common/rate-limit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

/** Roles that can move money or change what money moves. MFA is not optional. */
const MFA_REQUIRED_ROLES: readonly AdminRole[] = ['OPERATOR', 'FINANCE', 'ADMIN'];
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_SECONDS = 900;
const ADMIN_SESSION_TTL_SECONDS = 8 * 3600;

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Password plus TOTP, with a per-account lockout.
   *
   * The failure message is identical for an unknown email, a wrong password and
   * a wrong code. Distinguishing them is a free account-enumeration oracle, and
   * the admin panel is precisely where that matters.
   */
  async signIn(email: string, password: string, totpCode?: string) {
    await this.limiter.enforce(`admin-login:${email.toLowerCase()}`, 10, 900);

    const admin = await this.prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    const invalid = () => new AppError('UNAUTHENTICATED', 'Invalid credentials');

    if (!admin || admin.status !== 'ACTIVE') {
      // Still spend the time a real verification would, so the response time
      // does not reveal whether the account exists.
      this.crypto.verifySecret(password, this.crypto.hashSecret('decoy'));
      throw invalid();
    }

    if (admin.lockedUntil && admin.lockedUntil.getTime() > this.clock.nowMs()) {
      throw new AppError('RATE_LIMITED', 'This account is temporarily locked');
    }

    if (!this.crypto.verifySecret(password, admin.passwordHash)) {
      await this.registerFailure(admin.id, admin.failedLogins);
      throw invalid();
    }

    if (MFA_REQUIRED_ROLES.includes(admin.role)) {
      if (!admin.mfaSecretEnc) {
        throw new AppError('FORBIDDEN', 'Two-factor authentication must be set up for this role');
      }
      if (!totpCode || !verifyTotp(this.crypto.decrypt(admin.mfaSecretEnc), totpCode, this.clock.nowMs())) {
        await this.registerFailure(admin.id, admin.failedLogins);
        throw invalid();
      }
    }

    const token = this.crypto.generateToken(32);
    const session = await this.prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: this.crypto.hashToken(token),
        expiresAt: this.clock.plusSeconds(ADMIN_SESSION_TTL_SECONDS),
      },
    });

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: this.clock.now() },
    });

    await this.audit.record({
      action: 'admin.signed_in',
      subjectType: 'admin_user',
      subjectId: admin.id,
      actorType: 'ADMIN',
      actorId: admin.id,
    });

    return {
      token,
      expiresIn: ADMIN_SESSION_TTL_SECONDS,
      sessionId: session.id,
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  }

  async verifySessionToken(token: string) {
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: this.crypto.hashToken(token) },
      include: { adminUser: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= this.clock.nowMs() ||
      session.adminUser.status !== 'ACTIVE'
    ) {
      throw new AppError('UNAUTHENTICATED', 'Invalid admin session');
    }
    return { sessionId: session.id, admin: session.adminUser };
  }

  async signOut(sessionId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  /** Issues a TOTP secret for an admin who has none yet. */
  async beginMfaEnrolment(adminUserId: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    if (admin.mfaEnabledAt) {
      throw new AppError('FORBIDDEN', 'Two-factor authentication is already enabled');
    }
    const secret = generateTotpSecret();
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { mfaSecretEnc: this.crypto.encrypt(secret) },
    });
    return { secret, otpauthUrl: otpauthUrl(secret, admin.email) };
  }

  async confirmMfaEnrolment(adminUserId: string, code: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    if (!admin.mfaSecretEnc) throw new AppError('FORBIDDEN', 'Start the enrolment first');
    if (!verifyTotp(this.crypto.decrypt(admin.mfaSecretEnc), code, this.clock.nowMs())) {
      throw new AppError('UNAUTHENTICATED', 'That code is not right');
    }
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { mfaEnabledAt: this.clock.now() },
    });
    await this.audit.record({
      action: 'admin.mfa_enabled',
      subjectType: 'admin_user',
      subjectId: adminUserId,
      actorType: 'ADMIN',
      actorId: adminUserId,
    });
  }

  private async registerFailure(adminUserId: string, current: number): Promise<void> {
    const failed = current + 1;
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: {
        failedLogins: failed,
        lockedUntil:
          failed >= MAX_FAILED_LOGINS ? this.clock.plusSeconds(LOCKOUT_SECONDS) : null,
      },
    });
    if (failed >= MAX_FAILED_LOGINS) {
      this.logger.warning('Admin account locked after repeated failures', { adminUserId });
    }
  }
}
