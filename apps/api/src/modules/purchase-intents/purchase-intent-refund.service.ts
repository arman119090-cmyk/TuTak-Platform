import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  BonusEntryType,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
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
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async refund(params: PurchaseIntentRefundParams): Promise<PurchaseIntentRefundResult> {
    const intent = await this.prisma.purchaseIntent.findUnique({
      where: { id: params.purchaseIntentId },
    });
    if (!intent) throw new NotFoundException('Purchase intent not found');
    if (intent.status !== PurchaseIntentStatus.CONFIRMED) {
      throw new BadRequestException('Only a confirmed purchase can be refunded');
    }

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

    return this.idempotency.run<PurchaseIntentRefundResult>(
      {
        scope: `purchase-intent-refund:${params.actorId}`,
        key: params.idempotencyKey,
        request: { purchaseIntentId: intent.id, amount: amount.toString(), reason: params.reason },
      },
      () => this.executeRefund(intent.id, amount, params.reason, params.actorId, params.idempotencyKey),
    );
  }

  private async executeRefund(
    purchaseIntentId: string,
    amount: Decimal,
    reason: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<PurchaseIntentRefundResult> {
    // Crash-recovery: see RefundEngineService's identical check for why this
    // branch exists even though IdempotencyService normally answers first.
    const already = await this.findByKey(actorId, idempotencyKey);
    if (already) return this.toResult(already);

    try {
      return await this.runSerializable((tx) =>
        this.postRefund(tx, purchaseIntentId, amount, reason, actorId, idempotencyKey),
      );
    } catch (err) {
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(actorId, idempotencyKey);
        if (existing) return this.toResult(existing);
      }
      throw err;
    }
  }

  private async postRefund(
    tx: Tx,
    purchaseIntentId: string,
    amount: Decimal,
    reason: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<PurchaseIntentRefundResult> {
    const intent = await tx.purchaseIntent.findUniqueOrThrow({ where: { id: purchaseIntentId } });
    if (intent.status !== PurchaseIntentStatus.CONFIRMED) {
      throw new BadRequestException('Only a confirmed purchase can be refunded');
    }

    const cumulativeBefore = intent.refundedAmount;
    const cumulativeAfter = cumulativeBefore.plus(amount);
    // Re-checked inside the transaction: the pre-check in `refund()` read a
    // snapshot that a concurrent refund may have moved past by the time this
    // transaction's serializable snapshot was taken. The CHECK constraint
    // would refuse the write either way; this is what turns that into a
    // clean 400 instead of a raw constraint-violation 500.
    if (cumulativeAfter.greaterThan(intent.grossAmount)) {
      throw new BadRequestException(
        `Refund of ${amount.toString()} exceeds the ` +
          `${intent.grossAmount.minus(cumulativeBefore).toString()} still refundable on this purchase`,
      );
    }

    await tx.purchaseIntent.update({
      where: { id: intent.id },
      data: { refundedAmount: cumulativeAfter },
    });

    const { bonusRestored, ledgerTransactionId } = await this.reverseLoyaltyEffects(
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
   */
  private async reverseLoyaltyEffects(
    tx: Tx,
    intent: {
      id: string;
      customerId: string;
      partnerId: string;
      grossAmount: Decimal;
      bonusAmountRequested: Decimal;
      negotiatedRateBps: number;
      sourceTransactionId: string | null;
    },
    cumulativeBefore: Decimal,
    cumulativeAfter: Decimal,
    reason: string,
  ): Promise<{ bonusRestored: Decimal; ledgerTransactionId: string | null }> {
    const policy = this.config.get('purchasePolicy', { infer: true });
    const grossAmount = intent.grossAmount;
    const sourceTransactionId = intent.sourceTransactionId!;

    const shareAt = (total: Decimal, cumulative: Decimal): Decimal =>
      total.lessThanOrEqualTo(0) ? new Decimal(0) : roundIssued(total.times(cumulative).dividedBy(grossAmount));
    const delta = (total: Decimal): Decimal => shareAt(total, cumulativeAfter).minus(shareAt(total, cumulativeBefore));

    const pool = roundIssued(grossAmount.times(intent.negotiatedRateBps).dividedBy(10_000));
    const green = roundIssued(pool.times(policy.poolGreenBps).dividedBy(10_000));
    const deferred = roundIssued(pool.times(policy.poolDeferredBps).dividedBy(10_000));
    const referrerShare = roundIssued(pool.times(policy.poolReferrerBps).dividedBy(10_000));

    const poolΔ = delta(pool);
    const greenΔ = delta(green);
    const deferredΔ = delta(deferred);
    const referrerΔ = delta(referrerShare);
    // The remainder, exactly like `postContributionLedger`'s own `tutakBase`
    // — never independently rounded, so the four legs always sum to poolΔ.
    const tutakBaseΔ = poolΔ.minus(greenΔ).minus(deferredΔ).minus(referrerΔ);
    const bonusRestoreΔ = delta(intent.bonusAmountRequested);

    const referrer = await this.referralService.resolveReferrer(intent.customerId);

    if (greenΔ.greaterThan(0)) {
      const greenLot = await tx.bonusLot.findFirst({
        where: { sourceTransactionId, type: BonusEntryType.ACCRUAL_PURCHASE },
      });
      if (greenLot) await this.bonusEngine.reverseAccrualLot(greenLot.id, reason, greenΔ, tx);
    }

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
      if (referralLot) await this.bonusEngine.reverseAccrualLot(referralLot.id, reason, referrerΔ, tx);
    }

    let deferredLiabilityStillOutstanding = true;
    if (deferredΔ.greaterThan(0)) {
      const result = await this.deferredBonusLots.reverseForRefund(sourceTransactionId, deferredΔ, reason, tx);
      deferredLiabilityStillOutstanding = result.liabilityStillOutstanding;
    }

    if (bonusRestoreΔ.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: intent.customerId } });
      await this.bonusEngine.restoreSpentBonus(wallet.id, bonusRestoreΔ, sourceTransactionId, reason, tx);
    }

    const ledgerTransactionId = await this.postReversalLedger(tx, intent, {
      poolΔ,
      greenΔ,
      deferredΔ,
      referrerΔ,
      tutakBaseΔ,
      referrer,
      bonusRestoreΔ,
      deferredLiabilityStillOutstanding,
    });

    return { bonusRestored: bonusRestoreΔ, ledgerTransactionId };
  }

  /**
   * The mirror image of `PurchaseIntentsService.postContributionLedger` +
   * `postRedemptionCompensation`, scaled to this refund's proportional
   * share — never `LedgerService.reverse()`, which flips a transaction's
   * postings verbatim and has no notion of a partial amount.
   */
  private async postReversalLedger(
    tx: Tx,
    intent: { id: string; partnerId: string },
    amounts: {
      poolΔ: Decimal;
      greenΔ: Decimal;
      deferredΔ: Decimal;
      referrerΔ: Decimal;
      tutakBaseΔ: Decimal;
      referrer: ResolvedReferrer | null;
      bonusRestoreΔ: Decimal;
      deferredLiabilityStillOutstanding: boolean;
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
      // The deferred share moves to whichever account still actually holds
      // it: the confirmation-time BONUS_LIABILITY credit if the lot never
      // resolved, or PLATFORM_REVENUE if `expireOne` already released it
      // there — see `DeferredBonusLotService.reverseForRefund`.
      let customerLiabilityΔ = amounts.greenΔ.plus(amounts.referrer?.type === 'USER' ? amounts.referrerΔ : 0);
      let tutakRevenueΔ = amounts.tutakBaseΔ.plus(amounts.referrer ? 0 : amounts.referrerΔ);
      if (amounts.deferredLiabilityStillOutstanding) {
        customerLiabilityΔ = customerLiabilityΔ.plus(amounts.deferredΔ);
      } else {
        tutakRevenueΔ = tutakRevenueΔ.plus(amounts.deferredΔ);
      }

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
