import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  BonusEntryType,
  Prisma,
  ReferralChallengeParticipantStatus,
  ReferrerType,
  TransactionStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';

type Tx = Prisma.TransactionClient;

export type ResolvedReferrer =
  | { type: 'USER'; userId: string }
  | { type: 'PARTNER'; partnerId: string };

/**
 * Two referral mechanics live here, and they are not the same thing — see
 * docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md §3 for why one evolved from
 * the other rather than both being written fresh.
 *
 * 1. **The recurring 20%-of-pool share** (spec §6). Paid on *every* eligible
 *    confirmed purchase, for as long as the attribution exists — no cap, no
 *    deadline. `resolveReferrer`/`creditUserReferrerShare` are its only job
 *    here; the amount itself is computed by `PurchaseIntentService`, which
 *    also owns the partner-referrer ledger leg, because that leg has to
 *    balance against the same purchase's contribution posting in one atomic
 *    transaction — see that service for why it is not split across two
 *    `LedgerService.post()` calls.
 * 2. **The Referral Challenge** (spec §18-20): a one-time 1000+1000 AMD
 *    reward for a referrer's first three referees who *individually* reach
 *    10 000 AMD cumulative purchases, no deadline. This is the direct
 *    descendant of what used to be this file's only job — a flat one-time
 *    reward on a referee's first qualifying purchase — restructured to
 *    track cumulative progress and a hard three-slot limit instead.
 */
@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
  ) {}

  getMyCode(userId: string) {
    return this.prisma.referralCode.findUniqueOrThrow({ where: { userId } });
  }

  listMyInvites(userId: string) {
    return this.prisma.referralInvite.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        referee: { select: { id: true, firstName: true, lastName: true, createdAt: true } },
      },
    });
  }

  /**
   * Who — if anyone — attributed `refereeUserId` at registration. Spec §5:
   * set once, never reassigned; this is a lookup of that immutable record,
   * not a decision.
   */
  async resolveReferrer(refereeUserId: string): Promise<ResolvedReferrer | null> {
    const invite = await this.prisma.referralInvite.findUnique({ where: { refereeUserId } });
    if (!invite) return null;
    if (invite.referrerType === ReferrerType.PARTNER && invite.referrerPartnerId) {
      return { type: 'PARTNER', partnerId: invite.referrerPartnerId };
    }
    if (invite.referrerType === ReferrerType.USER && invite.referrerUserId) {
      return { type: 'USER', userId: invite.referrerUserId };
    }
    return null;
  }

  /**
   * Pays the recurring share to a USER referrer — spec §6: straight into
   * GREEN/AVAILABLE, immediately, no cooling-off. (`pendingHours: 0`
   * deliberately skips the ordinary accrual's pending window: that window
   * exists to blunt fabricated-purchase farming on the *purchase itself*,
   * which the referred purchase was already checked for before this is
   * called — the referrer's cut of a real purchase should not additionally
   * wait on its own clock.)
   *
   * The PARTNER-referrer case is deliberately not here — see the class
   * docblock for why that leg is `PurchaseIntentService`'s to post.
   */
  async creditUserReferrerShare(
    userId: string,
    amount: Decimal,
    sourceTransactionId: string,
    tx: Tx,
  ): Promise<void> {
    if (amount.lessThanOrEqualTo(0)) return;
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
    await this.bonusEngine.accrue(
      {
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_REFERRAL,
        amount,
        sourceTransactionId,
        pendingHours: 0,
      },
      tx,
    );
    await this.auditService.record(
      {
        actorUserId: userId,
        action: AuditAction.BONUS_ACCRUED,
        entityType: 'Wallet',
        entityId: wallet.id,
        metadata: { mechanism: 'referral_recurring_share', amount: amount.toString(), sourceTransactionId },
      },
      tx,
    );
  }

  /**
   * Creates the attribution record at registration — spec §5. Called once,
   * from `AuthService.register`, and never again for the same referee: the
   * unique constraint on `refereeUserId` is what makes "immutable" true
   * rather than merely intended. Also opens a Referral Challenge slot for a
   * USER referrer (spec §18) — a PARTNER referrer does not participate in
   * the Challenge, only in the recurring share.
   */
  async createAttribution(
    params: { refereeUserId: string; referrerCode: string },
    tx: Tx,
  ): Promise<void> {
    const code = await tx.referralCode.findUnique({ where: { code: params.referrerCode } });
    if (!code) return;

    if (code.userId) {
      if (code.userId === params.refereeUserId) return; // self-referral: not an error, just a no-op
      await tx.referralInvite.create({
        data: {
          referrerType: ReferrerType.USER,
          referrerUserId: code.userId,
          refereeUserId: params.refereeUserId,
        },
      });
      await tx.referralChallengeParticipant.create({
        data: {
          referrerUserId: code.userId,
          refereeUserId: params.refereeUserId,
          requiredAmount: this.config.get('purchasePolicy.challengeQualificationAmount', {
            infer: true,
          }),
        },
      });
      return;
    }

    if (code.partnerId) {
      await tx.referralInvite.create({
        data: {
          referrerType: ReferrerType.PARTNER,
          referrerPartnerId: code.partnerId,
          refereeUserId: params.refereeUserId,
        },
      });
    }
  }

  /**
   * Advances every Referral Challenge this user's purchase should count
   * toward, and rewards qualification when it happens — spec §18-20. Driven
   * by the same `transaction.completed` outbox event every transaction type
   * already emits (see `ReferralListener`), so a QR payment and a confirmed
   * PurchaseIntent both count without two separate wiring paths.
   *
   * No-ops instantly for the overwhelming majority of transactions — most
   * users were never referred, or their Challenge already resolved — via a
   * single indexed lookup before anything transactional happens.
   */
  async advanceChallengeProgress(refereeUserId: string, transactionId: string): Promise<void> {
    const participant = await this.prisma.referralChallengeParticipant.findUnique({
      where: { refereeUserId },
    });
    if (!participant || participant.status !== ReferralChallengeParticipantStatus.IN_PROGRESS) {
      return;
    }
    // Defence in depth: `createAttribution` already refuses to create a
    // self-referral row, so this should be unreachable in practice — but a
    // forged row must not pay out double into one wallet just because the
    // first line of defence was bypassed.
    if (participant.referrerUserId === refereeUserId) {
      this.logger.warn(`Refusing self-referral on challenge participant ${participant.id}`);
      return;
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { userId: true, partnerId: true, amount: true, status: true },
    });
    if (
      !transaction ||
      transaction.userId !== refereeUserId ||
      transaction.status !== TransactionStatus.COMPLETED ||
      // docs/AUDIT_2026-08-B.md §C4: a partnerless transaction is exactly
      // the shape of the farming loop this suite closes — a self-issued QR
      // redeemed against nothing, fabricating a COMPLETED row for free.
      // There is no commerce behind it, so it does not count toward the
      // Challenge either.
      !transaction.partnerId
    ) {
      return;
    }

    // Serializable: two of a referrer's friends can qualify in the same
    // instant, and the slot count below must not let both of them see "2 of
    // 3 taken" and both claim the third. Retried on a serialization failure
    // — Postgres aborts the loser of a genuine conflict rather than queuing
    // it, and `await`ing both sides of that race must not mean one of them
    // simply throws; see `LedgerService`'s own `withRetry` for the same
    // reasoning applied to the ledger.
    await this.runSerializable(async (tx) => {
        const updated = await tx.referralChallengeParticipant.update({
          where: { id: participant.id },
          data: { progressAmount: { increment: transaction.amount } },
        });

        if (updated.progressAmount.lessThan(updated.requiredAmount)) return;

        // Both sides verified, same as the flat one-time reward this evolved
        // from required (docs/AUDIT_2026-08-B.md §C4/§C5): an unverified
        // referrer is a farm's collection account, an unverified referee is
        // the fabricated signup it feeds on. Left IN_PROGRESS rather than
        // failing outright — a later purchase, after either side verifies,
        // re-checks this and can still qualify normally.
        const [referrer, referee] = await Promise.all([
          tx.user.findUnique({ where: { id: participant.referrerUserId }, select: { isPhoneVerified: true } }),
          tx.user.findUnique({ where: { id: refereeUserId }, select: { isPhoneVerified: true } }),
        ]);
        if (!referrer?.isPhoneVerified || !referee?.isPhoneVerified) {
          this.logger.warn(
            `Referral challenge ${participant.id} reached threshold but an unverified number is involved`,
          );
          return;
        }

        // Claim QUALIFIED first, conditionally — exactly one caller can move
        // this participant out of IN_PROGRESS, mirroring the atomicity this
        // file already relied on for the old one-time reward.
        const claimed = await tx.referralChallengeParticipant.updateMany({
          where: { id: participant.id, status: ReferralChallengeParticipantStatus.IN_PROGRESS },
          data: { status: ReferralChallengeParticipantStatus.QUALIFIED, qualifiedAt: new Date() },
        });
        if (claimed.count === 0) return;

        await this.tryRewardChallengeSlot(
          participant.referrerUserId,
          participant.refereeUserId,
          transactionId,
          tx,
        );
      });
  }

  /**
   * Serializable `$transaction`, retried on a serialization failure or
   * deadlock — the same retry `LedgerService` already applies to its own
   * postings, for the same reason: Serializable isolation aborts the loser
   * of a genuine conflict rather than queuing it, and the caller is expected
   * to just try again with the same, still-valid arguments.
   */
  private async runSerializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err) {
        const code = (err as { code?: string })?.code;
        const message = err instanceof Error ? err.message : '';
        const retryable =
          code === '40001' ||
          code === '40P01' ||
          /write conflict|deadlock|could not serialize/i.test(message);
        if (!retryable || attempt === maxAttempts) throw err;
        const delay = Math.floor(2 ** attempt * 5 * (0.5 + Math.random()));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    // Unreachable — the loop above always returns or throws.
    throw new Error('runSerializable exhausted retries without a result');
  }

  /**
   * Spec §18: only a referrer's first three *qualified* participants are
   * ever rewarded — qualification order, not invitation order, which is why
   * this is checked here, at qualification time, rather than capped at
   * `createAttribution`. A referrer with a hundred invitees can have a
   * hundred `IN_PROGRESS`/`QUALIFIED` rows; at most three ever reach
   * REWARDED.
   */
  private async tryRewardChallengeSlot(
    referrerUserId: string,
    refereeUserId: string,
    sourceTransactionId: string,
    tx: Tx,
  ): Promise<void> {
    const slotLimit = this.config.get('purchasePolicy.challengeSlotLimit', { infer: true });
    const rewardedCount = await tx.referralChallengeParticipant.count({
      where: { referrerUserId, status: ReferralChallengeParticipantStatus.REWARDED },
    });
    if (rewardedCount >= slotLimit) {
      this.logger.log(
        `Referral challenge for referrer ${referrerUserId}: referee ${refereeUserId} qualified but all ${slotLimit} slots are taken`,
      );
      return;
    }

    const claimed = await tx.referralChallengeParticipant.updateMany({
      where: { referrerUserId, refereeUserId, status: ReferralChallengeParticipantStatus.QUALIFIED },
      data: { status: ReferralChallengeParticipantStatus.REWARDED, rewardedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const rewardAmount = new Decimal(
      this.config.get('purchasePolicy.challengeRewardAmount', { infer: true }),
    );

    const [referrerWallet, refereeWallet] = await Promise.all([
      tx.wallet.findUniqueOrThrow({ where: { userId: referrerUserId } }),
      tx.wallet.findUniqueOrThrow({ where: { userId: refereeUserId } }),
    ]);

    // Spec §19: this is a conditional promotional entitlement until the
    // moment it is granted — never sitting in the wallet as spendable value
    // before this. Once granted, both sides are ordinary GREEN/AVAILABLE
    // bonus, immediately.
    //
    // TODO: BUSINESS DECISION REQUIRED — REFERRAL CHALLENGE FUNDING SOURCE.
    // `bonusEngine.accrue` below only ever mints wallet-level points; there
    // is deliberately no `LedgerService.post()` call anywhere in this
    // method. That means this reward posts no PARTNER_PAYABLE debit, no
    // PLATFORM_REVENUE credit, no BONUS_LIABILITY entry at all — it does
    // not charge any partner and it is not drawn from the 20/30/20/30
    // contribution pool (spec §20 explicitly forbids both). The two
    // `accrue` calls are eligibility/entitlement only; they do not
    // constitute real accounting until a funding source is chosen. Do not
    // add a ledger posting here without that decision having been made —
    // guessing a source (e.g. debiting PLATFORM_REVENUE unconditionally)
    // would be inventing a business rule this repository is explicitly not
    // authorized to invent.
    await Promise.all([
      this.bonusEngine.accrue(
        {
          walletId: referrerWallet.id,
          type: BonusEntryType.ACCRUAL_PROMOTION,
          amount: rewardAmount,
          sourceTransactionId,
          pendingHours: 0,
          metadata: { challenge: 'referral', role: 'referrer', refereeUserId },
        },
        tx,
      ),
      this.bonusEngine.accrue(
        {
          walletId: refereeWallet.id,
          type: BonusEntryType.ACCRUAL_PROMOTION,
          amount: rewardAmount,
          sourceTransactionId,
          pendingHours: 0,
          metadata: { challenge: 'referral', role: 'referee', referrerUserId },
        },
        tx,
      ),
    ]);

    // System-triggered, not a human actor — same reasoning
    // `PurchaseIntentsService.expireOne` already applies to its own
    // sweep-triggered audit entries: automated financial mutations are
    // audit-worthy regardless of whether a person clicked anything.
    await this.auditService.record(
      {
        action: AuditAction.BONUS_ACCRUED,
        entityType: 'ReferralChallengeParticipant',
        entityId: `${referrerUserId}:${refereeUserId}`,
        metadata: {
          mechanism: 'referral_challenge_reward',
          referrerUserId,
          refereeUserId,
          rewardAmount: rewardAmount.toString(),
          sourceTransactionId,
        },
      },
      tx,
    );

    this.logger.log(
      `Referral challenge slot filled: referrer ${referrerUserId} + referee ${refereeUserId}, ${rewardAmount} AMD each`,
    );
  }
}
