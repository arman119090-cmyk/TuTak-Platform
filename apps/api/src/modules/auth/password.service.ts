import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, NotificationChannel } from '@prisma/client';
import * as argon2 from 'argon2';
import { generateNumericCode, sha256Hex } from '../../common/utils/crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestMeta } from './auth.service';

/** A reset code is short-lived by design; a 10-minute window is ample by SMS. */
const RESET_TTL_MS = 10 * 60_000;

/** Guessing a 6-digit code needs to be expensive, so tries are strictly bounded. */
const MAX_RESET_ATTEMPTS = 5;

/**
 * Password lifecycle: change, reset, and forced rotation.
 *
 * Before this existed there was no way to change a password at all
 * (docs/AUDIT_2026-08-B.md §C3). A customer who forgot theirs lost access to
 * their balance permanently, and the seeded super-admin credential — which was
 * committed to the repository — could never be rotated through the product
 * (§C2).
 *
 * Every path that establishes a new password revokes every refresh token the
 * account holds. Changing a password whose compromise you suspect is worthless
 * if the attacker's session survives it.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Authenticated change. Requires the current password — a stolen access token alone must not be enough. */
  async change(userId: string, currentPassword: string, newPassword: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      await this.auditService.record({
        actorUserId: userId,
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'User',
        entityId: userId,
        metadata: { via: 'change_password' },
        ipAddress: meta.ipAddress,
      });
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await argon2.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException('New password must differ from the current one');
    }

    await this.applyNewPassword(userId, newPassword, 'change', meta);
    return { success: true };
  }

  /**
   * Starts a reset.
   *
   * Always reports success. Reporting whether a number is registered turns
   * this endpoint into an account-enumeration oracle, which is exactly the
   * mistake the login path made (§H10).
   */
  async requestReset(phone: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { phone } });

    if (user && user.isActive && !user.deletedAt) {
      const code = generateNumericCode(6);

      await this.prisma.$transaction(async (tx) => {
        // One live challenge per account: leaving older codes valid multiplies
        // the guessing surface for free.
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            codeHash: sha256Hex(code),
            expiresAt: new Date(Date.now() + RESET_TTL_MS),
          },
        });
      });

      // Persisted as an SMS-channel notification, the same shape every other
      // outbound message uses. Actual carrier dispatch is not implemented —
      // see the remaining-blockers section of the report.
      await this.notifications.send({
        userId: user.id,
        channel: NotificationChannel.SMS,
        titleKey: 'notifications.passwordResetTitle',
        bodyKey: 'notifications.passwordResetBody',
        params: { code },
      });

      await this.auditService.record({
        actorUserId: user.id,
        action: AuditAction.ACCOUNT_LOCKED,
        entityType: 'User',
        entityId: user.id,
        metadata: { via: 'password_reset_requested' },
        ipAddress: meta.ipAddress,
      });
    }

    return { success: true };
  }

  /** Completes a reset. Wrong codes are counted, and the challenge dies after too many. */
  async confirmReset(phone: string, code: string, newPassword: string, meta: RequestMeta) {
    const invalid = new UnauthorizedException('Reset code is invalid or has expired');

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.isActive || user.deletedAt) throw invalid;

    const challenge = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw invalid;

    if (challenge.codeHash !== sha256Hex(code)) {
      const attempts = challenge.attempts + 1;
      await this.prisma.passwordResetToken.update({
        where: { id: challenge.id },
        data: {
          attempts,
          // Burn the challenge rather than let it be ground down.
          ...(attempts >= MAX_RESET_ATTEMPTS ? { consumedAt: new Date() } : {}),
        },
      });
      throw invalid;
    }

    // Consume conditionally: two requests racing the same code must not both
    // succeed and both revoke each other's freshly issued tokens.
    const consumed = await this.prisma.passwordResetToken.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;

    await this.applyNewPassword(user.id, newPassword, 'reset', meta);
    return { success: true };
  }

  /**
   * The single write path for a new credential.
   *
   * Clears the forced-rotation flag, resets the lockout counters — a reset is
   * the legitimate way out of a lockout — and revokes every refresh token, so
   * no session predating the change survives it.
   */
  private async applyNewPassword(
    userId: string,
    newPassword: string,
    via: 'change' | 'reset',
    meta: RequestMeta,
  ) {
    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    });

    await this.auditService.record({
      actorUserId: userId,
      action: AuditAction.TOKEN_REVOKED,
      entityType: 'User',
      entityId: userId,
      metadata: { via: `password_${via}` },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    this.logger.log(`Password ${via} completed for user ${userId}; all sessions revoked`);
  }
}
