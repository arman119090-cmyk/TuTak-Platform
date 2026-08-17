import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  BonusEntryType,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, parsePositiveMoney, roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { ReferralService, ResolvedReferrer } from '../referral/referral.service';

type Tx = Prisma.TransactionClient;

export interface PurchaseIntentRefundParams {
  purchaseIntentId: string;
  /** Merchandise refund amount. Omit for a full refund of whatever remains unrefunded. */
  amount?: string;
  reason: string;
  actorId: string;
  idempotencyKey: string;
}

export interface PurchaseIntentRefundResult {
  refundId: string;
  amount: string;
  /** Total merchandise value refunded against this purchase after this refund, including this one. */
  totalRefunded: string;
  bonusRestored: string;
}

/** Did this come from the (actorId, idempotencyKey) unique index? Same reasoning as RefundEngineService's own check. */
function isKeyCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes('idempotencyKey'));
}

/**
 * Replaces the PSP-style refund concept for ordinary TuTak purchases.
 *
 * A partner enters only the merchandise refund amount — TuTak never refunds
 * real money through this path; the partner repays the customer outside
 * TuTak, exactly as spec'd. What this reverses, proportional to how much of
 * the merchandise is coming back, is every loyalty effect
 * `PurchaseIntentsService.settlePurchase` created: the customer's spent
 * bonus (restored), the purchase accrual, the referral share, the deferred
 * lot this purchase created, and the partner-contribution/redemption-
 * compensation ledger postings. Deliberately not built on `Refund`/
 * `Payment`/`RefundEngineService` — see the migration's own comment.
 *
 * One atomic Serializable transaction per refund, retried on a
 * serialization conflict — the same idiom `ReferralService.runSerializable`
 * and `LedgerService.post`'s own retry already use, needed here for the same
 * reason `BonusEngineService.reserve` needs it: the amount to reverse is
 * derived from reading `refundedAmount` and must not be computed from a
 * stale snapshot two concurrent partial refunds both read.
 */
@Injectable()
export class PurchaseIntentRefundService {
  private readonly logger = new Logger(PurchaseIntentRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly referralService: ReferralService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Deliberately does *no* state-dependent validation here — not existence,
   * not status, not `remaining`/`amount`. Every one of those used to be
   * checked before `idempotency.run()` was even called, using whatever
   * `refundedAmount` happened to read *right now* — which a prior call with
   * this exact key may itself have just changed. A full refund succeeding
   * makes `remaining` 0; a partial refund succeeding can shrink `remaining`
   * below a since-completed request's own `amount`. Either way, the *exact
   * same request retried* then failed its own precheck (`"already refunded
   * in full"` / `"exceeds the … still refundable"`) instead of ever
   * reaching the idempotency store — defeating the entire point of the key
   * (independent audit, GitHub issue #28). All of that validation now lives
   * in `postRefund`, reached only when `idempotency.run()` decides this is
   * genuinely new work, never on a replay of already-completed work.
   *
   * The hash `idempotency.run()` keys on is the caller's *raw* request
   * (`params.amount` verbatim, `null` when omitted for "refund whatever
   * remains") rather than a numeric value resolved from mutable state —
   * otherwise an implicit full-refund replay would hash differently after
   * `remaining` changed and be misread as a *conflicting* reuse of the key
   * instead of the same request. Reusing the key with a genuinely different
   * `amount`/`reason` still hashes differently and is still rejected by
   * `IdempotencyService.claim()`'s own fingerprint check — untouched by this
   * change.
   */
  async refund(params: PurchaseIntentRefundParams): Promise<PurchaseIntentRefundResult> {
    return this.idempotency.run<PurchaseIntentRefundResult>(
      {
        scope: `purchase-intent-refund:${params.actorId}`,
        key: params.idempotencyKey,
        request: {
          purchaseIntentId: params.purchaseIntentId,
          amount: params.amount ?? null,
          reason: params.reason,
        },
      },
      () => this.executeRefund(params),
    );
  }

  private async executeRefund(params: PurchaseIntentRefundParams): Promise<PurchaseIntentRefundResult> {
    // Crash-recovery: see RefundEngineService's identical check for why this
    // branch exists even though IdempotencyService normally answers first.
    const already = await this.findByKey(params.actorId, params.idempotencyKey);
    if (already) return this.toResult(already);

    try {
      return await this.runSerializable((tx) => this.postRefund(tx, params));
    } catch (err) {
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(params.actorId, params.idempotencyKey);
        if (existing) return this.toResult(existing);
      }
      throw err;
    }
  }

  private async postRefund(tx: Tx, params: PurchaseIntentRefundParams): Promise<PurchaseIntentRefundResult> {
    const { purchaseIntentId, reason, actorId, idempotencyKey } = params;
    const intent = await tx.purchaseIntent.findUnique({ where: { id: purchaseIntentId } });
    if (!intent) throw new NotFoundException('Purchase intent not found');
    if (intent.status !== PurchaseIntentStatus.CONFIRMED) {
      throw new BadRequestException('Only a confirmed purchase can be refunded');
    }
    // `poolAmount`/`greenAmount`/`deferredAmount`/`referrerAmount` are
    // nullable columns added by migration `20260817010000` with no backfill
    // — every `settlePurchase` confirmation since has written all four
    // unconditionally (even when the pool is genuinely zero), so `null` here
    // can only mean this purchase was confirmed *before* that migration
    // existed, when nothing captured its pool split at all. `?? 0` further
    // down would silently reverse zero loyalty effects for a purchase that
    // may really have granted real bonus — this repository has not yet
    // reached a production launch with real customer data (see
    // `docs/LAUNCH_READINESS_2026-08-16.md`), so no safe reconstruction is
    // possible or necessary: launch requires a clean database with no
    // pre-migration `PurchaseIntent` rows, and this fails closed instead of
    // ever silently under-reversing one (independent audit, GitHub issue
    // #28).
    if (
      intent.poolAmount === null ||
      intent.greenAmount === null ||
      intent.deferredAmount === null ||
      intent.referrerAmount === null
    ) {
      throw new InternalServerErrorException(
        `Purchase intent ${intent.id} was confirmed before pool-split snapshots existed (poolAmount/greenAmount/` +
          'deferredAmount/referrerAmount are null) and cannot be refunded automatically — its original loyalty ' +
          'effects were never recorded, so a refund cannot be proven correct. Requires manual reconciliation.',
      );
    }

    // Read fresh inside this Serializable transaction, never outside it —
    // this is the only place `remaining`/`amount` get resolved now, so a
    // replay of an already-completed request never reaches here at all
    // (see `refund()`'s docblock) and a genuinely new request always
    // validates against the current, real `refundedAmount`.
    const remaining = intent.grossAmount.minus(intent.refundedAmount);
    const amount = params.amount ? parsePositiveMoney(params.amount, 'refund amount') : remaining;
    if (remaining.lessThanOrEqualTo(0)) {
      throw new BadRequestException('This purchase has already been refunded in full');
    }
    if (amount.greaterThan(remaining)) {
      throw new BadRequestException(
        `Refund of ${amount.toString()} exceeds the ${remaining.toString()} still refundable on this purchase`,
      );
    }

    const cumulativeBefore = intent.refundedAmount;
    const cumulativeAfter = cumulativeBefore.plus(amount);

    await tx.purchaseIntent.update({
      where: { id: intent.id },
      data: { refundedAmount: cumulativeAfter },
    });

    const { bonusRestored, ledgerTransactionId, shortfall } = await this.reverseLoyaltyEffects(
      tx,
      intent,
      cumulativeBefore,
      cumulativeAfter,
      reason,
    );

    const refund = await tx.purchaseIntentRefund.create({
      data: {
        purchaseIntentId: intent.id,
        amount,
        bonusRestored,
        reason,
        ledgerTransactionId,
        actorId,
        idempotencyKey,
      },
    });

    await this.auditService.record(
      {
        actorUserId: actorId,
        action: AuditAction.PURCHASE_INTENT_REFUNDED,
        entityType: 'PurchaseIntent',
        entityId: intent.id,
        metadata: {
          refundId: refund.id,
          amount: amount.toString(),
          totalRefunded: cumulativeAfter.toString(),
          bonusRestored: bonusRestored.toString(),
          // Earned-bonus liability that could not be reclaimed from wallets
          // (already spent elsewhere or expired) — see `reverseLoyaltyEffects`.
          unrecoverableShortfall: shortfall.toString(),
          reason,
        },
      },
      tx,
    );

    this.logger.log(
      `Refunded ${amount.toString()} of purchase intent ${intent.id} (total ${cumulativeAfter.toString()})`,
    );

    return {
      refundId: refund.id,
      amount: amount.toFixed(MONEY_SCALE),
      totalRefunded: cumulativeAfter.toFixed(MONEY_SCALE),
      bonusRestored: bonusRestored.toFixed(MONEY_SCALE),
    };
  }

  /**
   * Reverses every loyalty effect this purchase's own confirmation created,
   * proportional to `amount / grossAmount`, computed as the difference
   * between the cumulative entitlement at the new and old refunded totals —
   * so a full refund always reverses exactly the original amounts (the
   * watermark at `grossAmount` equals the total by construction) and
   * cumulative partial refunds can never over-reverse, independent of
   * rounding on any individual step.
   *
   * The pool/green/deferred/referrer totals below are read from the
   * `PurchaseIntent`'s own confirmation-time snapshot — never recomputed
   * from `purchasePolicy`. A refund must reverse exactly what
   * `settlePurchase` actually posted; if the platform's pool-split
   * percentages change between confirmation and refund, recomputing from
   * today's configuration would reverse different amounts than the ones on
   * the books (independent audit, GitHub issue #28, HEAD `0a9c7d5`).
   */
  private async reverseLoyaltyEffects(
    tx: Tx,
    intent: {
      id: string;
      customerId: string;
      partnerId: string;
      grossAmount: Decimal;
      bonusAmountRequested: Decimal;
      poolAmount: Decimal | null;
      greenAmount: Decimal | null;
      deferredAmount: Decimal | null;
      referrerAmount: Decimal | null;
      sourceTransactionId: string | null;
    },
    cumulativeBefore: Decimal,
    cumulativeAfter: Decimal,
    reason: string,
  ): Promise<{ bonusRestored: Decimal; ledgerTransactionId: string | null; shortfall: Decimal }> {
    const grossAmount = intent.grossAmount;
    const sourceTransactionId = intent.sourceTransactionId!;

    const shareAt = (total: Decimal, cumulative: Decimal): Decimal =>
      total.lessThanOrEqualTo(0) ? new Decimal(0) : roundIssued(total.times(cumulative).dividedBy(grossAmount));
    const delta = (total: Decimal): Decimal => shareAt(total, cumulativeAfter).minus(shareAt(total, cumulativeBefore));

    // Only ever null for an intent that was never confirmed, which can't
    // reach a refund — `refund()`/`postRefund` both require CONFIRMED.
    const pool = intent.poolAmount ?? new Decimal(0);
    const green = intent.greenAmount ?? new Decimal(0);
    const deferred = intent.deferredAmount ?? new Decimal(0);
    const referrerShare = intent.referrerAmount ?? new Decimal(0);

    const poolΔ = delta(pool);
    const greenΔ = delta(green);
    const deferredΔ = delta(deferred);
    const referrerΔ = delta(referrerShare);
    // The remainder, exactly like `postContributionLedger`'s own `tutakBase`
    // — never independently rounded, so the four legs always sum to poolΔ.
    const tutakBaseΔ = poolΔ.minus(greenΔ).minus(deferredΔ).minus(referrerΔ);
    const bonusRestoreΔ = delta(intent.bonusAmountRequested);

    const referrer = await this.referralService.resolveReferrer(intent.customerId);

    // `reverseAccrualLot` claws back only a lot's *unspent* remainder and
    // returns exactly that amount — `null` if the lot was already fully
    // spent or had expired. The ledger reversal must debit `BONUS_LIABILITY`
    // for what actually came back from the wallet, not the theoretical
    // share: debiting the full share regardless would double-reverse value
    // whose liability was already released elsewhere (independent audit,
    // GitHub issue #28, HEAD `0a9c7d5`). Whatever the theoretical share
    // could not reclaim is `shortfall`, tracked explicitly below rather
    // than silently assumed either way.
    const zero = new Decimal(0);
    let greenClawed = zero;
    if (greenΔ.greaterThan(0)) {
      const greenLot = await tx.bonusLot.findFirst({
        where: { sourceTransactionId, type: BonusEntryType.ACCRUAL_PURCHASE },
      });
      if (greenLot) {
        const clawed = await this.bonusEngine.reverseAccrualLot(greenLot.id, reason, greenΔ, tx);
        greenClawed = clawed ?? zero;
      }
    }
    const greenShortfall = greenΔ.minus(greenClawed);

    let referrerClawed = zero;
    if (referrer?.type === 'USER' && referrerΔ.greaterThan(0)) {
      const referrerWallet = await tx.wallet.findUnique({ where: { userId: referrer.userId } });
      const referralLot = referrerWallet
        ? await tx.bonusLot.findFirst({
            where: {
              sourceTransactionId,
              type: BonusEntryType.ACCRUAL_REFERRAL,
              walletId: referrerWallet.id,
            },
          })
        : null;
      if (referralLot) {
        const clawed = await this.bonusEngine.reverseAccrualLot(referralLot.id, reason, referrerΔ, tx);
        referrerClawed = clawed ?? zero;
      }
    }
    const referrerShortfall = referrer?.type === 'USER' ? referrerΔ.minus(referrerClawed) : zero;

    let deferredLiabilityToReverse = zero;
    let deferredShortfall = zero;
    if (deferredΔ.greaterThan(0)) {
      const result = await this.deferredBonusLots.reverseForRefund(sourceTransactionId, deferredΔ, reason, tx);
      deferredLiabilityToReverse = result.liabilityToReverse;
      deferredShortfall = result.shortfall;
    }

    // This purchase's own turnover contribution to *other* deferred lots
    // (via `advanceExistingLots`) and to the customer's Referral Challenge
    // progress (via `advanceChallengeProgress`) are both proportional to the
    // raw refunded amount, not the pool split — a straight dollar-for-dollar
    // relationship, unlike the legs above. Independent audit, GitHub issue
    // #28: neither used to be reversed at all.
    const rawRefundΔ = cumulativeAfter.minus(cumulativeBefore);
    await this.deferredBonusLots.reverseExternalContributions(sourceTransactionId, rawRefundΔ, reason, tx);
    await this.referralService.reverseChallengeContribution(sourceTransactionId, rawRefundΔ, reason, tx);

    // Unrecoverable: value the customer already spent elsewhere (whose own
    // transaction already released this liability) or that expired
    // unclaimed. Neither case leaves anything real to take back from the
    // customer, so it cannot reduce `BONUS_LIABILITY` a second time —
    // routed to `PLATFORM_REVENUE` instead, the same treatment
    // `DeferredBonusLotService.expireOne` already gives value that will
    // never be paid out. Logged so it stays visible rather than a silent
    // rounding-shaped adjustment in the postings.
    const shortfall = greenShortfall.plus(referrerShortfall).plus(deferredShortfall);
    if (shortfall.greaterThan(0)) {
      this.logger.warn(
        `Purchase intent ${intent.id} refund: ${shortfall.toString()} of the earned bonus liability ` +
          'could not be reclaimed from wallets (already spent or expired) and was released to platform revenue.',
      );
    }

    if (bonusRestoreΔ.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: intent.customerId } });
      await this.bonusEngine.restoreSpentBonus(wallet.id, bonusRestoreΔ, sourceTransactionId, reason, tx);
    }

    const ledgerTransactionId = await this.postReversalLedger(tx, intent, {
      poolΔ,
      greenClawed,
      deferredLiabilityToReverse,
      referrerClawed,
      referrerΔ,
      tutakBaseΔ,
      referrer,
      bonusRestoreΔ,
      shortfall,
    });

    return { bonusRestored: bonusRestoreΔ, ledgerTransactionId, shortfall };
  }

  /**
   * The mirror image of `PurchaseIntentsService.postContributionLedger` +
   * `postRedemptionCompensation`, scaled to this refund's proportional
   * share — never `LedgerService.reverse()`, which flips a transaction's
   * postings verbatim and has no notion of a partial amount.
   *
   * `poolΔ` (what the partner is credited back) always stays the full
   * theoretical merchandise-refund share — the partner's contribution
   * obligation shrinks by exactly the fraction of the sale reversed,
   * regardless of what later happened to the bonus it funded. `greenClawed`
   * / `deferredLiabilityToReverse` / `referrerClawed` are what actually came
   * back from wallets (see `reverseLoyaltyEffects`), so `customerLiabilityΔ`
   * can be smaller than the theoretical share; `shortfall` — the difference
   * — is folded into `tutakRevenueΔ` so the posting still balances to
   * `poolΔ` by construction, the same remainder technique `tutakBaseΔ`
   * itself already uses.
   */
  private async postReversalLedger(
    tx: Tx,
    intent: { id: string; partnerId: string },
    amounts: {
      poolΔ: Decimal;
      greenClawed: Decimal;
      deferredLiabilityToReverse: Decimal;
      referrerClawed: Decimal;
      referrerΔ: Decimal;
      tutakBaseΔ: Decimal;
      referrer: ResolvedReferrer | null;
      bonusRestoreΔ: Decimal;
      shortfall: Decimal;
    },
  ): Promise<string | null> {
    if (amounts.poolΔ.lessThanOrEqualTo(0) && amounts.bonusRestoreΔ.lessThanOrEqualTo(0)) {
      return null;
    }

    const [partnerAccount, bonusLiabilityAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
    ]);

    let primaryTransactionId: string | null = null;

    if (amounts.poolΔ.greaterThan(0)) {
      const customerLiabilityΔ = amounts.greenClawed
        .plus(amounts.deferredLiabilityToReverse)
        .plus(amounts.referrer?.type === 'USER' ? amounts.referrerClawed : 0);
      const tutakRevenueΔ = amounts.tutakBaseΔ
        .plus(amounts.referrer ? 0 : amounts.referrerΔ)
        .plus(amounts.shortfall);

      const postings = [
        { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: amounts.poolΔ },
        ...(customerLiabilityΔ.greaterThan(0)
          ? [{ accountId: bonusLiabilityAccount.id, direction: PostingDirection.DEBIT, amount: customerLiabilityΔ }]
          : []),
        ...(amounts.referrer?.type === 'PARTNER' && amounts.referrerΔ.greaterThan(0)
          ? [
              {
                accountId: (
                  await this.ledger.accountFor(
                    { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: amounts.referrer.partnerId },
                    tx,
                  )
                ).id,
                direction: PostingDirection.DEBIT,
                amount: amounts.referrerΔ,
              },
            ]
          : []),
        ...(tutakRevenueΔ.greaterThan(0)
          ? [{ accountId: revenueAccount.id, direction: PostingDirection.DEBIT, amount: tutakRevenueΔ }]
          : []),
      ];

      const transaction = await this.ledger.post(
        {
          kind: 'partner.contribution_refund',
          sourceType: 'PurchaseIntent',
          sourceId: intent.id,
          postings,
        },
        tx,
      );
      primaryTransactionId = transaction.id;
    }

    if (amounts.bonusRestoreΔ.greaterThan(0)) {
      await this.ledger.post(
        {
          kind: 'partner.bonus_redemption_compensation_refund',
          sourceType: 'PurchaseIntent',
          sourceId: intent.id,
          postings: [
            { accountId: bonusLiabilityAccount.id, direction: PostingDirection.CREDIT, amount: amounts.bonusRestoreΔ },
            { accountId: partnerAccount.id, direction: PostingDirection.DEBIT, amount: amounts.bonusRestoreΔ },
          ],
        },
        tx,
      );
    }

    return primaryTransactionId;
  }

  private findByKey(actorId: string, idempotencyKey: string) {
    return this.prisma.purchaseIntentRefund.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
    });
  }

  private toResult(refund: {
    id: string;
    amount: Decimal;
    bonusRestored: Decimal;
    purchaseIntentId: string;
  }): Promise<PurchaseIntentRefundResult> {
    // Re-read rather than trust a stored snapshot: other refunds may have
    // landed against this purchase since, same reasoning as
    // RefundEngineService.toResult.
    return this.prisma.purchaseIntent
      .findUniqueOrThrow({ where: { id: refund.purchaseIntentId } })
      .then((intent) => ({
        refundId: refund.id,
        amount: refund.amount.toFixed(MONEY_SCALE),
        totalRefunded: intent.refundedAmount.toFixed(MONEY_SCALE),
        bonusRestored: refund.bonusRestored.toFixed(MONEY_SCALE),
      }));
  }

  listForIntent(purchaseIntentId: string) {
    return this.prisma.purchaseIntentRefund.findMany({
      where: { purchaseIntentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Serializable `$transaction`, retried on a serialization failure or
   * deadlock — the same idiom `ReferralService.runSerializable` and
   * `LedgerService`'s own retry already use. Needed here because the amount
   * to reverse is derived from `refundedAmount`, read and used within the
   * same transaction; two concurrent partial refunds against the same
   * purchase must not both compute their share from the same stale total.
   */
  private async runSerializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err) {
        if (isKeyCollision(err)) throw err;
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
}
