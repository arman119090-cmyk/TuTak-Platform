import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  BonusEntryType,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  ReferralChallengeParticipantStatus,
  ReferralProgramVersion,
  ReferrerType,
  TransactionStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';

type Tx = Prisma.TransactionClient;

export type ResolvedReferrer =
  | { type: 'USER'; userId: string }
  | { type: 'PARTNER'; partnerId: string };

/** Re-exported for callers that only need the program-version type, not the whole Prisma namespace. */
export { ReferralProgramVersion };

/** The 3-level chain's own per-level entry — `ResolvedReferrer` plus which level (1-3) it occupies. */
export type ReferralChainLevel = ResolvedReferrer & { level: 1 | 2 | 3 };

/**
 * The six-leg pool split the 3-level referral rework produces (2026-08-22)
 * — every Decimal a real, already-rounded amount, with `tutak` always the
 * residual (`pool - green - deferred - l1 - l2 - l3`), never independently
 * rounded, so the six legs always sum to exactly `pool` by construction —
 * see `ReferralService.computePoolSplit`.
 */
export interface ReferralPoolSplit {
  pool: Decimal;
  green: Decimal;
  deferred: Decimal;
  l1: Decimal;
  l2: Decimal;
  l3: Decimal;
  tutak: Decimal;
  chain: ReferralChainLevel[];
}

/**
 * The current program's default — every new confirmation stamps this
 * explicitly onto its own snapshot row. Never compared against; the boot
 * validation and the six bps legs are the only things that actually decide
 * how a purchase is priced. Bumping this to a hypothetical future version
 * is a business decision, not something to do casually — see
 * `ReferralProgramVersion`'s schema docblock.
 */
export const CURRENT_REFERRAL_PROGRAM_VERSION = ReferralProgramVersion.THREE_LEVEL_V2;

/**
 * Three referral mechanics live here, and they are not the same thing — see
 * docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md §3 and the 2026-08-22 3-level
 * rework (`docs/NEXT_CLAUDE_TASK.md`, GitHub issue #28 comment 5360139848)
 * for why they evolved the way they did rather than being written fresh.
 *
 * 1. **The 3-level upward chain's recurring pool share** (2026-08-22,
 *    superseding the single-level 20%-of-pool share). Paid on *every*
 *    eligible confirmed purchase, for as long as each level's attribution
 *    exists — no cap, no deadline. L1 = whoever directly referred the
 *    customer, L2 = whoever referred L1, L3 = whoever referred L2; a
 *    partner referrer at any level is paid but does not continue the chain
 *    (spec: "a partner is not a continuation of the customer chain").
 *    `resolveReferralChain`/`computePoolSplit`/`creditChainShares` are this
 *    mechanic's whole job here; the caller (`PurchaseIntentsService`,
 *    `EvSessionsService`) still owns the partner-referrer ledger leg and
 *    the overall contribution posting, because those legs have to balance
 *    against the same purchase's posting in one atomic transaction.
 * 2. **Legacy single-level share** (`resolveReferrer`/`creditUserReferrerShare`,
 *    pre-2026-08-22). Kept, unmodified, purely so a `PurchaseIntent`/
 *    `EvSession` row confirmed before the 3-level rework — `programVersion`
 *    null — can still be refunded/corrected against the exact mechanic that
 *    originally priced it. No code path uses this for a new confirmation.
 * 3. **The Referral Challenge** (spec §18-20): a one-time 1000+1000 AMD
 *    reward for a referrer's first three referees who *individually* reach
 *    10 000 AMD cumulative purchases, no deadline. Deliberately untouched
 *    by the 3-level rework (requirement 6: "do not extend Referral
 *    Challenge to L2/L3... the chain must not multiply Challenge rewards")
 *    — it only ever looks at a referee's *direct* (L1) referrer.
 */
@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
    private readonly ledger: LedgerService,
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
   *
   * @deprecated for pricing a *new* purchase — `resolveReferralChain` below
   * is the current mechanic's L1 (its first entry, when present, is exactly
   * what this method returns). Kept for two reasons only: the Referral
   * Challenge, which is deliberately L1-only forever (see the class
   * docblock), and reversing a *legacy* (`programVersion` null)
   * `PurchaseIntent`/`EvSession` row exactly the way it was originally
   * priced.
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
   * Walks up to 3 levels of `ReferralInvite`'s immutable parent-pointer
   * chain — spec: L1 = whoever directly referred `refereeUserId`, L2 =
   * whoever referred L1, L3 = whoever referred L2. Stops early, safely,
   * whenever:
   *
   *  - there is no attribution at the next level (a genuinely short chain —
   *    the caller's `computePoolSplit` folds the missing level(s) into
   *    TuTak's own residual share, never leaves them unpaid or
   *    redistributes them to the levels that do exist);
   *  - the current level's referrer is a PARTNER — spec: "a partner is not
   *    a continuation of the customer chain" — that partner is still
   *    included as this level's own entry (paid via the partner-payable
   *    ledger, never a customer wallet), but nothing above it is resolved;
   *  - the next level would repeat a subject already in this chain
   *    (including `refereeUserId` itself) — a self-referral or a cycle.
   *    `ReferralInvite.refereeUserId` is unique and written exactly once,
   *    at registration (spec §5), so every user has at most one parent and
   *    the attribution graph is structurally a forest — a cycle should be
   *    unreachable through the normal registration flow. This check is
   *    defence in depth regardless, mirroring the same-shaped guard
   *    `advanceChallengeProgress` already carries for exactly this reason:
   *    money must never be credited around a cycle, whatever caused it.
   *
   * Read-only and safe to resolve before a settlement's own transaction —
   * same reasoning `PurchaseIntentsService.settlePurchase` already gives
   * for its single `resolveReferrer` call: attribution is immutable once
   * created, so it cannot change between this read and the transaction
   * that uses it.
   */
  /** Explicit return type so the loop below doesn't ask TS to infer a recursive type for `invite`. */
  private findInviteFor(refereeUserId: string): Promise<{
    referrerType: ReferrerType;
    referrerUserId: string | null;
    referrerPartnerId: string | null;
  } | null> {
    return this.prisma.referralInvite.findUnique({ where: { refereeUserId } });
  }

  async resolveReferralChain(refereeUserId: string): Promise<ReferralChainLevel[]> {
    const chain: ReferralChainLevel[] = [];
    const seen = new Set<string>([`user:${refereeUserId}`]);
    let currentUserId: string | null = refereeUserId;

    for (let level = 1; level <= 3; level += 1) {
      const lookupUserId: string | null = currentUserId;
      if (!lookupUserId) break;
      const invite = await this.findInviteFor(lookupUserId);
      if (!invite) break;

      if (invite.referrerType === ReferrerType.PARTNER && invite.referrerPartnerId) {
        const key = `partner:${invite.referrerPartnerId}`;
        if (seen.has(key)) {
          this.logger.warn(
            `Referral chain for ${refereeUserId} repeats partner ${invite.referrerPartnerId} at level ${level} — stopping chain walk, no payout for the repeat`,
          );
          break;
        }
        seen.add(key);
        chain.push({ level: level as 1 | 2 | 3, type: 'PARTNER', partnerId: invite.referrerPartnerId });
        break; // spec: a partner referrer does not continue the chain.
      }

      if (invite.referrerType === ReferrerType.USER && invite.referrerUserId) {
        const key = `user:${invite.referrerUserId}`;
        if (seen.has(key)) {
          this.logger.warn(
            `Referral chain for ${refereeUserId} repeats user ${invite.referrerUserId} at level ${level} (self-referral or cycle) — stopping chain walk, no payout for the repeat`,
          );
          break;
        }
        seen.add(key);
        chain.push({ level: level as 1 | 2 | 3, type: 'USER', userId: invite.referrerUserId });
        currentUserId = invite.referrerUserId;
        continue;
      }

      // Malformed row (neither branch matched) — nothing safe to resolve further.
      break;
    }

    return chain;
  }

  /**
   * The 3-level rework's single canonical pool split (2026-08-22) — every
   * caller that prices a purchase under the new program (`PurchaseIntentsService
   * .settlePurchase`, `EvSessionsService.stopOnce`) calls this and only
   * this, so the formula lives in exactly one place.
   *
   * `pool = green + deferred + l1 + l2 + l3 + tutak`, always, by
   * construction: green/deferred/l1/l2/l3 are each independently rounded
   * (`roundIssued`, truncating in the platform's favour), and `tutak` is
   * whatever is left — never independently rounded — so the six legs sum
   * to exactly `pool` for any `pool`/bps combination, the same "derive the
   * last leg as a residual" pattern this codebase already uses for its
   * four-leg predecessor. A level with no chain entry contributes 0 to its
   * own leg, which — because `tutak` is a residual, not a fixed bps share —
   * automatically folds that level's whole bps allocation into TuTak's
   * share. No level is ever left unpaid, and no level's share is ever
   * redistributed to a level that does exist.
   */
  computePoolSplit(pool: Decimal, chain: ReferralChainLevel[]): ReferralPoolSplit {
    const policy = this.config.get('purchasePolicy', { infer: true });
    const l1Entry = chain.find((c) => c.level === 1);
    const l2Entry = chain.find((c) => c.level === 2);
    const l3Entry = chain.find((c) => c.level === 3);

    const green = roundIssued(pool.times(policy.poolGreenBps).dividedBy(10_000));
    const deferred = roundIssued(pool.times(policy.poolDeferredBps).dividedBy(10_000));
    const l1 = l1Entry ? roundIssued(pool.times(policy.poolReferrerL1Bps).dividedBy(10_000)) : new Decimal(0);
    const l2 = l2Entry ? roundIssued(pool.times(policy.poolReferrerL2Bps).dividedBy(10_000)) : new Decimal(0);
    const l3 = l3Entry ? roundIssued(pool.times(policy.poolReferrerL3Bps).dividedBy(10_000)) : new Decimal(0);
    const tutak = pool.minus(green).minus(deferred).minus(l1).minus(l2).minus(l3);

    return { pool, green, deferred, l1, l2, l3, tutak, chain };
  }

  /**
   * Pays every USER-type level in the chain its own share — spec §6's
   * "straight into GREEN/AVAILABLE, immediately" behaviour, generalised
   * from one level to up to three. A PARTNER-type level is deliberately
   * skipped here: its share is a ledger-only leg (the caller's own
   * partner-payable posting), never a customer wallet bonus — same
   * reasoning `creditUserReferrerShare`'s docblock already gives for why
   * the PARTNER case lives in the caller, not here.
   */
  async creditChainShares(
    chain: ReferralChainLevel[],
    amounts: { l1: Decimal; l2: Decimal; l3: Decimal },
    sourceTransactionId: string,
    tx: Tx,
  ): Promise<void> {
    const byLevel: Record<1 | 2 | 3, Decimal> = { 1: amounts.l1, 2: amounts.l2, 3: amounts.l3 };
    for (const entry of chain) {
      if (entry.type !== 'USER') continue;
      const amount = byLevel[entry.level];
      if (!amount || amount.lessThanOrEqualTo(0)) continue;
      await this.creditUserReferrerShare(entry.userId, amount, sourceTransactionId, tx, entry.level);
    }
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
   * docblock for why that leg is the caller's own ledger posting to make.
   *
   * @param level Which chain level this share is for (1/2/3) — the 3-level
   *   rework's `creditChainShares` passes it through so the audit trail
   *   distinguishes an L1 payout from an L2/L3 one; omitted by the legacy
   *   single-level caller, which has only ever had one level.
   */
  async creditUserReferrerShare(
    userId: string,
    amount: Decimal,
    sourceTransactionId: string,
    tx: Tx,
    level?: 1 | 2 | 3,
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
        ...(level ? { metadata: { referralLevel: level } } : {}),
      },
      tx,
    );
    await this.auditService.record(
      {
        actorUserId: userId,
        action: AuditAction.BONUS_ACCRUED,
        entityType: 'Wallet',
        entityId: wallet.id,
        metadata: {
          mechanism: 'referral_recurring_share',
          amount: amount.toString(),
          sourceTransactionId,
          ...(level ? { referralLevel: level } : {}),
        },
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

        // Traceability for `reverseChallengeContribution`: this transaction
        // only ever reaches here while the participant is IN_PROGRESS (the
        // guard at the top of this method), so recording it now is the only
        // reliable way a later refund can know this specific amount is part
        // of the current tally (independent audit, GitHub issue #28).
        await tx.referralChallengeContribution.create({
          data: { participantId: participant.id, transactionId, amount: transaction.amount },
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
   * Reverses the progress a refunded purchase contributed to the referee's
   * Referral Challenge, closing the gap that let a refunded purchase
   * permanently qualify (or help qualify) a reward (independent audit,
   * GitHub issue #28): without this, `progressAmount` only ever grew, so a
   * customer could buy enough to qualify a referrer's Challenge slot, then
   * refund the purchase and keep the qualification.
   *
   * Looks up by `transactionId` rather than by referee: `advanceChallengeProgress`
   * only ever creates a `ReferralChallengeContribution` row for a
   * transaction that actually counted (it early-exits once the participant
   * leaves IN_PROGRESS), so a transaction with no row is proof it never
   * contributed and this is a safe no-op for it.
   *
   * If the drop takes `progressAmount` back below `requiredAmount`, the
   * qualification itself is undone regardless of how far it had
   * progressed — QUALIFIED reverts with nothing further to do (nothing was
   * ever paid), and REWARDED reverts *and* claws the reward back via
   * `reverseReward` (independent audit, GitHub issue #28: a REWARDED
   * participant used to be left untouched, letting a refund-after-reward
   * farming loop keep the 1,000+1,000 AMD indefinitely).
   */
  async reverseChallengeContribution(
    transactionId: string,
    amount: Decimal,
    reason: string,
    tx: Tx,
  ): Promise<void> {
    if (amount.lessThanOrEqualTo(0)) return;

    const contribution = await tx.referralChallengeContribution.findUnique({
      where: { transactionId },
      include: { participant: true },
    });
    if (!contribution) return;

    const reversible = contribution.amount.minus(contribution.reversedAmount);
    if (reversible.lessThanOrEqualTo(0)) return;
    const reduceBy = Decimal.min(amount, reversible);
    if (reduceBy.lessThanOrEqualTo(0)) return;

    await tx.referralChallengeContribution.update({
      where: { id: contribution.id },
      data: { reversedAmount: { increment: reduceBy } },
    });

    const newProgress = contribution.participant.progressAmount.minus(reduceBy);
    const droppedBelowThreshold = newProgress.lessThan(contribution.participant.requiredAmount);
    const wasQualified = contribution.participant.status === ReferralChallengeParticipantStatus.QUALIFIED;
    const wasRewarded = contribution.participant.status === ReferralChallengeParticipantStatus.REWARDED;

    const data: Prisma.ReferralChallengeParticipantUpdateInput = { progressAmount: newProgress };
    // A slot a REWARDED participant held is freed the instant its status
    // stops being REWARDED — `tryRewardChallengeSlot`'s slot check is a
    // live `count()` against that status, not a separately tracked
    // allocation, so reverting it here is the whole of "handle the slot
    // deterministically": the very next qualifying referee for this
    // referrer sees one fewer taken.
    if (droppedBelowThreshold && (wasQualified || wasRewarded)) {
      data.status = ReferralChallengeParticipantStatus.IN_PROGRESS;
      data.qualifiedAt = null;
      data.rewardedAt = null;
    }
    await tx.referralChallengeParticipant.update({ where: { id: contribution.participantId }, data });

    if (droppedBelowThreshold && wasRewarded) {
      await this.reverseReward(contribution.participant, reason, tx);
    }
  }

  /**
   * Claws back a Referral Challenge reward after a refund has dropped its
   * participant's `progressAmount` back below `requiredAmount` — the
   * qualifying event the reward was paid on turned out not to be real
   * (independent audit, GitHub issue #28).
   *
   * Each side's `BonusLot` (recorded on the participant at grant time —
   * see `tryRewardChallengeSlot`) is clawed back independently: one side
   * may have already spent theirs while the other has not, and
   * `reverseAccrualLot` only ever reclaims what is genuinely still unspent
   * in that specific wallet, so this can never drive either balance
   * negative.
   *
   * Whatever cannot be reclaimed (already spent, or independently expired)
   * is a shortfall with nothing further to post: the original reward's own
   * `BONUS_LIABILITY` credit was already released at the moment it left
   * that wallet (an ordinary redemption's own compensation leg, or that
   * `BonusLot`'s own expiry sweep) — crediting it again here would double
   * count, the same reasoning `reverseUnlock` and
   * `PurchaseIntentRefundService.reverseLoyaltyEffects` already apply to
   * their own shortfalls.
   *
   * The recovered portion is posted independently of whatever refund
   * triggered this, mirroring the original grant's own posting in
   * `tryRewardChallengeSlot` but reversed: DEBIT `BONUS_LIABILITY` / CREDIT
   * `PLATFORM_REVENUE` — TuTak funded the reward from its own funds, so
   * reclaiming it is TuTak's own recovered revenue, not this refund's
   * partner's concern.
   */
  private async reverseReward(
    participant: {
      referrerUserId: string;
      refereeUserId: string;
      referrerBonusLotId: string | null;
      refereeBonusLotId: string | null;
    },
    reason: string,
    tx: Tx,
  ): Promise<void> {
    const zero = new Decimal(0);

    // The historical source of truth is each side's own `BonusLot.originalAmount`
    // — set once, at grant time, and never mutated afterward — not today's
    // `purchasePolicy.challengeRewardAmount` (independent audit, GitHub issue
    // #28: a reward issued at 1000+1000 AMD must reverse as 1000+1000 no
    // matter what the live config says by the time a refund drops this
    // participant back below `requiredAmount`, possibly months later). Same
    // pattern `DeferredBonusLotService.reverseUnlock` already uses for the
    // same reason.
    const [referrerLot, refereeLot] = await Promise.all([
      participant.referrerBonusLotId
        ? tx.bonusLot.findUnique({
            where: { id: participant.referrerBonusLotId },
            select: { originalAmount: true },
          })
        : null,
      participant.refereeBonusLotId
        ? tx.bonusLot.findUnique({
            where: { id: participant.refereeBonusLotId },
            select: { originalAmount: true },
          })
        : null,
    ]);
    const referrerGranted = referrerLot?.originalAmount ?? zero;
    const refereeGranted = refereeLot?.originalAmount ?? zero;
    const totalGranted = referrerGranted.plus(refereeGranted);

    // No cap passed: the whole grant is invalid, so whatever is still
    // unspent in the lot — never more than `originalAmount`, by
    // construction — is reclaimed in full, exactly as `reverseUnlock` does.
    const [referrerClawed, refereeClawed] = await Promise.all([
      participant.referrerBonusLotId
        ? this.bonusEngine.reverseAccrualLot(participant.referrerBonusLotId, reason, undefined, tx)
        : null,
      participant.refereeBonusLotId
        ? this.bonusEngine.reverseAccrualLot(participant.refereeBonusLotId, reason, undefined, tx)
        : null,
    ]);
    const referrerActual = referrerClawed ?? zero;
    const refereeActual = refereeClawed ?? zero;
    const shortfall = referrerGranted.minus(referrerActual).plus(refereeGranted.minus(refereeActual));

    if (shortfall.greaterThan(0)) {
      this.logger.warn(
        `Referral challenge reward reversed for referrer ${participant.referrerUserId} / referee ` +
          `${participant.refereeUserId}: ${shortfall.toString()} of the ${totalGranted.toString()} ` +
          'originally granted could not be reclaimed (already spent or expired) and was written off.',
      );
    }

    const recovered = referrerActual.plus(refereeActual);
    if (recovered.greaterThan(0)) {
      const [bonusLiabilityAccount, revenueAccount] = await Promise.all([
        this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
        this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
      ]);
      await this.ledger.post(
        {
          kind: 'referral.challenge_reward_reversed',
          sourceType: 'ReferralChallengeParticipant',
          sourceId: `${participant.referrerUserId}:${participant.refereeUserId}`,
          postings: [
            { accountId: bonusLiabilityAccount.id, direction: PostingDirection.DEBIT, amount: recovered },
            { accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: recovered },
          ],
        },
        tx,
      );
    }

    this.logger.log(
      `Referral challenge reward reversed: referrer ${participant.referrerUserId} + referee ` +
        `${participant.refereeUserId}, ${recovered.toString()} of ${totalGranted.toString()} reclaimed.`,
    );
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
    // bonus, immediately. CONFIRMED business decision (2026-08-16, GitHub
    // Issue #28 Finding 1): no additional pending/lock period after
    // REWARDED — `pendingHours: 0` below is intentional, not an oversight,
    // and must not be changed to add a QUALIFIED/REWARD_ENTITLED non-
    // spendable state.
    //
    // Funding source — CONFIRMED business decision (2026-08-16, GitHub
    // Issue #28 Finding 1): "TuTak funds the full 2,000 AMD Referral
    // Challenge reward (1,000 + 1,000) from TuTak's company funds." No
    // partner is charged and nothing is drawn from the 20/30/20/30
    // contribution pool (spec §20 explicitly forbids both) — this is a
    // marketing/promotional expense TuTak itself absorbs, mirrored below by
    // debiting PLATFORM_REVENUE (TuTak's own funds) and crediting
    // BONUS_LIABILITY by the same 2000 AMD the two `accrue` calls mint into
    // the two wallets, so the liability this reward creates is backed by a
    // real ledger entry rather than existing only at the wallet level.
    const [referrerLot, refereeLot] = await Promise.all([
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

    // Recorded so a later refund that un-qualifies this participant can
    // find and claw back exactly these two lots — see `reverseReward`
    // (independent audit, GitHub issue #28).
    await tx.referralChallengeParticipant.update({
      where: { refereeUserId },
      data: { referrerBonusLotId: referrerLot.id, refereeBonusLotId: refereeLot.id },
    });

    // `tx` here is Serializable (`runSerializable`, the caller several
    // frames up) — `accountFor` must be given it explicitly, or the
    // find/create happens on a separate connection outside this
    // transaction's snapshot and the `post()` below hits a foreign key
    // violation on an account that exists in the database but not yet in
    // this transaction's view of it. See `accountFor`'s docblock.
    const [revenueAccount, bonusLiabilityAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
    ]);
    const totalRewardAmount = rewardAmount.times(2);
    await this.ledger.post(
      {
        kind: 'referral.challenge_reward',
        sourceType: 'ReferralChallengeParticipant',
        sourceId: `${referrerUserId}:${refereeUserId}`,
        postings: [
          { accountId: revenueAccount.id, direction: PostingDirection.DEBIT, amount: totalRewardAmount },
          { accountId: bonusLiabilityAccount.id, direction: PostingDirection.CREDIT, amount: totalRewardAmount },
        ],
      },
      tx,
    );

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
