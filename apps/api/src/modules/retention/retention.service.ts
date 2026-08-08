import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QrCodeStatus } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface RetentionResult {
  notifications: number;
  refreshTokens: number;
  passwordResetTokens: number;
  phoneVerificationTokens: number;
  qrCodes: number;
  idempotencyRecords: number;
  outboxEvents: number;
}

/**
 * Deletes what the platform has no reason to keep.
 *
 * Nothing here was ever deleted: notifications, spent verification codes,
 * consumed idempotency keys and processed outbox rows accumulated for the
 * lifetime of the deployment. As a technical matter that is only disk. As a
 * legal matter it is holding personal data with no retention period at all,
 * which is the thing data-protection law actually objects to — not that you
 * hold data, but that you never decided for how long.
 *
 * ## What is deliberately not here
 *
 * Every financial record. Transactions, payments, refunds, settlements,
 * payouts, ledger accounts and postings, bonus lots and the bonus ledger are
 * untouched by this sweep and must stay that way: they are the double-entry
 * record, deleting any part of it breaks reconciliation permanently, and
 * accounting rules require them for years regardless of what privacy law
 * would prefer.
 *
 * Audit logs are also untouched. They are the accountability trail — the
 * answer to "who disabled that partner", "who confirmed that payout" — and a
 * trail with a hole in it is not a trail. When a user is anonymised, the
 * audit rows survive pointing at a user row that no longer says who they
 * were, which is the correct outcome: the action stays attributable, the
 * person does not stay identifiable.
 *
 * Fraud signals stay too. They exist to recognise a pattern repeating, and a
 * pattern that is pruned is a pattern that works again.
 *
 * ## On the periods
 *
 * The defaults below are engineering judgements about what the code needs,
 * not legal advice, and they are configurable precisely because the final
 * numbers should come from a lawyer who knows which regime applies. Each one
 * is set to comfortably exceed the longest window in which anything still
 * reads that row.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async prune(now = new Date()): Promise<RetentionResult> {
    const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60_000);
    const periods = this.config.get('retention', { infer: true });

    // Read notifications only. An unread one is still owed to its recipient
    // however old it is, and silently dropping it would mean a customer never
    // learns their points expired.
    const notifications = await this.prisma.notification.deleteMany({
      where: { isRead: true, createdAt: { lt: days(periods.notificationDays) } },
    });

    // Expired or revoked only — a live session must survive its own cleanup.
    // These rows carry the IP address and user agent of every sign-in, which
    // is the most sensitive thing in this list.
    const refreshTokens = await this.prisma.refreshToken.deleteMany({
      where: {
        createdAt: { lt: days(periods.sessionDays) },
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }],
      },
    });

    // Single-use challenges. Once expired they can never be redeemed, so
    // there is nothing to protect and a phone-linked row to remove. The
    // window is generous only so that an abuse investigation has something to
    // look at the week after the event.
    const passwordResetTokens = await this.prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: days(periods.challengeDays) } },
    });
    const phoneVerificationTokens = await this.prisma.phoneVerificationToken.deleteMany({
      where: { expiresAt: { lt: days(periods.challengeDays) } },
    });

    // A QR code that was used or expired is spent. The *transaction* it
    // produced is the record that matters and lives elsewhere.
    const qrCodes = await this.prisma.qrCode.deleteMany({
      where: {
        status: { in: [QrCodeStatus.REDEEMED, QrCodeStatus.EXPIRED, QrCodeStatus.VOID] },
        expiresAt: { lt: days(periods.qrCodeDays) },
      },
    });

    // Completed only, and only well past any client's retry horizon. Deleting
    // an in-flight key would let a retry execute a second payment; deleting a
    // completed one too early would do the same, which is why this is the
    // longest of the short periods rather than the shortest.
    const idempotencyRecords = await this.prisma.idempotencyRecord.deleteMany({
      where: { completedAt: { not: null, lt: days(periods.idempotencyDays) } },
    });

    // Processed only. An unprocessed outbox row is settlement that has not
    // happened yet — pruning one would lose money silently, which is the
    // exact failure the outbox exists to prevent.
    const outboxEvents = await this.prisma.outboxEvent.deleteMany({
      where: { processedAt: { not: null, lt: days(periods.outboxDays) } },
    });

    const result: RetentionResult = {
      notifications: notifications.count,
      refreshTokens: refreshTokens.count,
      passwordResetTokens: passwordResetTokens.count,
      phoneVerificationTokens: phoneVerificationTokens.count,
      qrCodes: qrCodes.count,
      idempotencyRecords: idempotencyRecords.count,
      outboxEvents: outboxEvents.count,
    };

    const total = Object.values(result).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      this.logger.log(`Retention pruned ${total} row(s): ${JSON.stringify(result)}`);
    }
    return result;
  }
}
