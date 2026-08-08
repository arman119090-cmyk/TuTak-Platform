import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  BonusLotStatus,
  BonusReservationStatus,
  EvSessionStatus,
  RoleName,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface DeletionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface DeletionReceipt {
  deletedAt: Date;
  /** When the personal data will be scrubbed, so the app can state it plainly. */
  anonymizedAfter: Date;
}

/**
 * Deleting an account on a platform that keeps a double-entry ledger.
 *
 * Apple has required since 2022 that an app offering account creation offer
 * account deletion *from inside the app*, and Google Play requires the same
 * plus a web page that works without installing anything. Neither is
 * satisfiable by literally deleting the row: `users` is referenced by
 * payments, transactions, ledger postings and audit entries, and removing it
 * would either break those references or take the financial record with it —
 * a record the business is separately required to keep.
 *
 * So deletion here means two things happening at two different times.
 *
 *  1. **Immediately**: access ends. `deletedAt` is set, which every auth path
 *     already refuses on, every refresh token is revoked and every device
 *     (and its push token) is removed. From the customer's side the account
 *     is gone — they cannot sign in, and nothing will ever be sent to them
 *     again.
 *  2. **After the grace window**: the personal fields are overwritten.
 *     Phone, email and name become placeholders, the password hash becomes
 *     an unusable random value, notifications are removed, and the remaining
 *     loyalty points are retired so the platform stops carrying a liability
 *     to somebody who no longer exists.
 *
 * The gap between the two is not hedging. A card chargeback or a
 * partner-initiated refund can arrive days after a payment and has to post
 * against a wallet whose owner row is still intact; and a customer who
 * deleted by mistake needs a window in which support can restore them, which
 * is impossible once the phone number is gone. Thirty days covers both and is
 * short enough that we are not holding phone numbers for no reason.
 *
 * What survives anonymisation, permanently: every ledger posting, payment,
 * refund and transaction, attached to a user row that no longer says who the
 * user was. That is the shape the accounting requires and the shape privacy
 * law asks for — the money is still auditable, the person is not identifiable.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get graceMs(): number {
    return this.config.get('accountDeletion.graceDays', { infer: true }) * 24 * 60 * 60_000;
  }

  /**
   * A customer deleting their own account.
   *
   * The password is required, and that is not friction for its own sake: the
   * access token is a fifteen-minute bearer credential, so without this a
   * stolen phone or a leaked token would be enough to destroy someone's
   * account and their points. Re-proving the password is the difference
   * between "holds a token" and "is the account owner".
   */
  async requestDeletion(userId: string, password: string, meta: DeletionMeta = {}) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } }, wallet: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt) {
      throw new ConflictException('This account is already scheduled for deletion');
    }

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Password is incorrect');
    }

    // A partner owner or an administrator deleting themselves would orphan a
    // business or remove the last person who can operate the platform, and
    // neither is a decision a self-service endpoint should be able to make.
    // Customers are the only accounts this route is for.
    const nonCustomerRoles = user.roles
      .map((r) => r.role.name)
      .filter((name) => name !== RoleName.CUSTOMER);
    if (nonCustomerRoles.length > 0) {
      throw new BadRequestException(
        'Accounts with partner or administrative roles cannot be deleted from the app. ' +
          'Contact support so the role can be transferred first.',
      );
    }

    await this.assertNothingInFlight(userId, user.wallet?.id);

    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt,
          // Both flags, deliberately. `deletedAt` states intent and
          // `isActive` is what several older checks read; leaving them able
          // to disagree is how an account ends up half-deleted.
          isActive: false,
        },
      });

      // Sessions end now, not when the tokens happen to expire.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: deletedAt },
      });

      // Push tokens are an identifier and a delivery channel at once. A
      // deleted account must not be reachable, so these go immediately
      // rather than waiting for the grace window.
      await tx.device.deleteMany({ where: { userId } });

      await this.audit.record(
        {
          actorUserId: userId,
          action: AuditAction.ACCOUNT_DELETION_REQUESTED,
          entityType: 'User',
          entityId: userId,
          metadata: { anonymizeAfter: new Date(deletedAt.getTime() + this.graceMs).toISOString() },
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        },
        tx,
      );
    });

    this.logger.log(`User ${userId} requested deletion; anonymisation due in ${this.graceMs}ms`);

    return {
      deletedAt,
      anonymizedAfter: new Date(deletedAt.getTime() + this.graceMs),
    } satisfies DeletionReceipt;
  }

  /**
   * Refuses while money is still moving.
   *
   * A charging session that is running will produce an accrual against this
   * wallet minutes from now, and an active bonus reservation means a payment
   * is mid-flight. Deleting underneath either leaves a settlement with
   * nowhere to land — better to ask the customer to finish, which takes
   * minutes, than to accept a stuck transaction that takes an operator.
   */
  private async assertNothingInFlight(userId: string, walletId?: string): Promise<void> {
    const activeSessions = await this.prisma.evSession.count({
      where: {
        userId,
        status: {
          in: [
            EvSessionStatus.RESERVED,
            EvSessionStatus.AUTHORIZED,
            EvSessionStatus.CHARGING,
            EvSessionStatus.SUSPENDED,
          ],
        },
      },
    });
    if (activeSessions > 0) {
      throw new ConflictException(
        'Finish your charging session before deleting your account.',
      );
    }

    if (walletId) {
      const holds = await this.prisma.bonusReservation.count({
        where: { walletId, status: BonusReservationStatus.ACTIVE },
      });
      if (holds > 0) {
        throw new ConflictException(
          'A payment is still being processed. Try again in a few minutes.',
        );
      }
    }
  }

  /**
   * Scrubs every account whose grace window has elapsed.
   *
   * Driven by the `account.anonymize-deleted` sweep. One user per
   * transaction: a slow batch that fails halfway should leave the accounts it
   * already finished finished, not roll back a hundred of them because the
   * hundred-and-first had a constraint problem.
   */
  async anonymizeDue(now = new Date()): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: {
        deletedAt: { not: null, lte: new Date(now.getTime() - this.graceMs) },
        anonymizedAt: null,
      },
      select: { id: true, wallet: { select: { id: true } } },
    });

    let done = 0;
    for (const user of due) {
      try {
        await this.anonymize(user.id, user.wallet?.id, now);
        done += 1;
      } catch (err) {
        // Logged rather than thrown: one problematic account must not stop
        // the others being scrubbed, and the sweep will find this one again
        // on its next run.
        this.logger.error(
          `Could not anonymise user ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (done > 0) this.logger.log(`Anonymised ${done} deleted account(s)`);
    return done;
  }

  private async anonymize(userId: string, walletId: string | undefined, now: Date): Promise<void> {
    // Unique across `users.phone` and unguessable, so nothing can be reverse
    // engineered from the placeholder and two scrubbed accounts cannot
    // collide.
    const token = randomBytes(9).toString('hex');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: `deleted-${token}`,
          email: null,
          firstName: 'Deleted',
          lastName: 'Account',
          // Not an empty string and not a reused constant: a random value
          // that argon2 will never verify against, so no password can ever
          // match this row even by accident.
          passwordHash: randomBytes(32).toString('hex'),
          isPhoneVerified: false,
          isActive: false,
          anonymizedAt: now,
        },
      });

      // Notification bodies carry names and amounts, and there is nobody left
      // to read them.
      await tx.notification.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.device.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.phoneVerificationToken.deleteMany({ where: { userId } });

      if (walletId) {
        // Retiring the balance rather than zeroing it. Setting `expiresAt` in
        // the past hands the lots to `bonus.expire-lots`, which already
        // writes the EXPIRY postings that keep BONUS_LIABILITY correct —
        // deleting the numbers here instead would leave the ledger claiming
        // the platform still owes points to somebody who no longer exists.
        await tx.bonusLot.updateMany({
          where: {
            walletId,
            status: { in: [BonusLotStatus.AVAILABLE, BonusLotStatus.PENDING] },
            remainingAmount: { gt: 0 },
          },
          data: { expiresAt: now },
        });
      }

      await this.audit.record(
        {
          actorUserId: null,
          action: AuditAction.ACCOUNT_ANONYMIZED,
          entityType: 'User',
          entityId: userId,
          metadata: { graceDays: this.config.get('accountDeletion.graceDays', { infer: true }) },
        },
        tx,
      );
    });
  }
}
