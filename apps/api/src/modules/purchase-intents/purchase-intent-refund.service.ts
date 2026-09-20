import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  BonusEntryType,
  ExternalRefundStatus,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  PaymentRoute,
  PurchaseIntentStatus,
  ReferralProgramVersion,
  ReferrerType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { MONEY_SCALE, parsePositiveMoney, roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerBalanceService } from '../customer-balance/customer-balance.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { PSP_ADAPTER, PspAdapter } from '../psp/psp-adapter.interface';
import { ReferralService, ResolvedReferrer } from '../referral/referral.service';

/** One stored (never re-walked) snapshot level of a THREE_LEVEL_V2 `PurchaseIntent`'s referrer chain. */
interface SnapshotLevel {
  level: 1 | 2 | 3;
  type: ReferrerType | null;
  userId: string | null;
  partnerId: string | null;
  amountΔ: Decimal;
}

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
  /** This refund's slice of the stored-money component, back on the customer's balance. */
  prepaidRestored: string;
  /** The slice the partner owes the customer outside TuTak. Zero when nothing was paid at the till. */
  externalRefundDue: string;
  /** `NOT_REQUIRED` / `PENDING_PARTNER` / `CONFIRMED` — never "completed" while the partner still owes. */
  externalRefundStatus: ExternalRefundStatus;
}

/**
 * The three slices of one refund, each computed by the same watermark rule
 * (`entitlement(after) − entitlement(before)`), which is what makes them sum
 * exactly and never drift across partial refunds. `external` is the
 * residual, never independently rounded, for the reason
 * `ReferralService.computePoolSplit` gives for its own `tutak` leg.
 */
export function splitRefundAcrossComponents(params: {
  amount: Decimal;
  grossAmount: Decimal;
  bonusAmountRequested: Decimal;
  prepaidAmountApplied: Decimal;
  cumulativeBefore: Decimal;
  cumulativeAfter: Decimal;
}): { bonus: Decimal; prepaid: Decimal; external: Decimal } {
  const shareAt = (total: Decimal, cumulative: Decimal): Decimal =>
    total.lessThanOrEqualTo(0)
      ? new Decimal(0)
      : roundIssued(total.times(cumulative).dividedBy(params.grossAmount));
  const delta = (total: Decimal): Decimal =>
    shareAt(total, params.cumulativeAfter).minus(shareAt(total, params.cumulativeBefore));
  const bonus = delta(params.bonusAmountRequested);
  const prepaid = delta(params.prepaidAmountApplied);
  return { bonus, prepaid, external: params.amount.minus(bonus).minus(prepaid) };
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
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(PSP_ADAPTER) private readonly adapter: PspAdapter,
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly referralService: ReferralService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly customerBalance: CustomerBalanceService,
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

  private async executeRefund(
    params: PurchaseIntentRefundParams,
  ): Promise<PurchaseIntentRefundResult> {
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

  /**
   * A purchase the provider collected cannot be refunded here yet.
   *
   * ## Why this is a refusal and not a workaround
   *
   * Arman's decision of 15.09.2026, and he ruled out both of the obvious
   * workarounds by name. Neither was rejected for being hard:
   *
   *  - **A routine manual bank transfer back to the customer.** It moves the
   *    right amount, and it leaves no record at the provider tying the return
   *    to the original payment. A chargeback three months later is then
   *    argued with a bank statement against a provider ledger that still says
   *    the customer paid and was never refunded.
   *  - **Refunding in bonus points.** The customer paid real money. Points
   *    are spendable at TuTak partners on TuTak's terms, and swapping one for
   *    the other without asking is not a refund, it is a forced purchase.
   *
   * What is left is to say so. The loyalty side of a refund — reversing
   * accrual, deferred lots, referrer shares — is not the hard part and is not
   * what is missing; the hard part is returning money through a provider
   * whose refund API nobody has confirmed exists.
   *
   * Two gates, deliberately, because either alone would be a lie: the flag
   * says the business has decided refunds may happen, and
   * `capabilities.refund` says the provider can actually perform one. A flag
   * cannot conjure an API, and an API nobody has approved the use of should
   * not fire because an environment variable drifted.
   *
   * `DIRECT_PARTNER` purchases are untouched — the partner took the money at
   * the till and gives it back at the till, exactly as before this route
   * existed.
   */
  private assertRefundableRoute(intent: { id: string; paymentRoute: PaymentRoute }): void {
    if (intent.paymentRoute !== PaymentRoute.TUTAK_PSP) return;

    const allowed =
      this.config.get('features.pspRefundsEnabled', { infer: true }) &&
      this.adapter.capabilities.refund;
    if (allowed) return;

    this.logger.warn(
      `Refusing a refund on provider-collected purchase ${intent.id}: ` +
        `flag=${String(this.config.get('features.pspRefundsEnabled', { infer: true }))} ` +
        `providerRefundCapability=${String(this.adapter.capabilities.refund)}`,
    );
    throw new BadRequestException(
      'This purchase was paid through a payment provider, and returning that money ' +
        'is not available yet. Escalate it to finance — do not refund it by hand or ' +
        'in bonus points.',
    );
  }

  private async postRefund(
    tx: Tx,
    params: PurchaseIntentRefundParams,
  ): Promise<PurchaseIntentRefundResult> {
    const { purchaseIntentId, reason, actorId, idempotencyKey } = params;
    const intent = await tx.purchaseIntent.findUnique({ where: { id: purchaseIntentId } });
    if (!intent) throw new NotFoundException('Purchase intent not found');
    this.assertRefundableRoute(intent);
    if (intent.status !== PurchaseIntentStatus.CONFIRMED) {
      throw new BadRequestException('Only a confirmed purchase can be refunded');
    }
    // `poolAmount`/`greenAmount`/`deferredAmount` are nullable columns added
    // by migration `20260817010000` with no backfill — every `settlePurchase`
    // confirmation since has written them unconditionally (even when the
    // pool is genuinely zero), so `null` here can only mean this purchase was
    // confirmed *before* that migration existed, when nothing captured its
    // pool split at all. `?? 0` further down would silently reverse zero
    // loyalty effects for a purchase that may really have granted real bonus
    // — this repository has not yet reached a production launch with real
    // customer data (see `docs/LAUNCH_READINESS_2026-08-16.md`), so no safe
    // reconstruction is possible or necessary: launch requires a clean
    // database with no pre-migration `PurchaseIntent` rows, and this fails
    // closed instead of ever silently under-reversing one (independent
    // audit, GitHub issue #28).
    //
    // `programVersion` (2026-08-22 3-level rework) is the explicit,
    // persisted eligibility boundary — which snapshot columns are the
    // authoritative ones to check and later reverse. THREE_LEVEL_V2 rows
    // always carry `referrer1..3Amount`/`tutakAmount` (written as 0, never
    // left null, even when a level had no recipient); legacy (`null`) rows
    // carry the old singular `referrerAmount` instead. Reversing a legacy
    // row still never re-walks the live referral chain — see
    // `reverseLoyaltyEffectsLegacy` — matching THREE_LEVEL_V2's own
    // snapshot-only reversal.
    if (intent.programVersion === ReferralProgramVersion.THREE_LEVEL_V2) {
      if (
        intent.poolAmount === null ||
        intent.greenAmount === null ||
        intent.deferredAmount === null ||
        intent.referrer1Amount === null ||
        intent.referrer2Amount === null ||
        intent.referrer3Amount === null ||
        intent.tutakAmount === null
      ) {
        throw new InternalServerErrorException(
          `Purchase intent ${intent.id} is THREE_LEVEL_V2 but its pool-split snapshot is incomplete — cannot be ` +
            'refunded automatically. Requires manual reconciliation.',
        );
      }
    } else if (
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

    // Dispatch on the persisted eligibility boundary — never on today's
    // config, and never by re-walking the live referral chain (spec:
    // "subsequent refund/CDR/retry must never re-walk the current chain").
    // A THREE_LEVEL_V2 row reverses against its own `referrer1..3Amount`/
    // `tutakAmount` snapshot; a legacy row reverses exactly as it always
    // has, against `referrerAmount`.
    const { bonusRestored, ledgerTransactionId, shortfall } =
      intent.programVersion === ReferralProgramVersion.THREE_LEVEL_V2
        ? await this.reverseLoyaltyEffectsV2(tx, intent, cumulativeBefore, cumulativeAfter, reason)
        : await this.reverseLoyaltyEffectsLegacy(
            tx,
            intent,
            cumulativeBefore,
            cumulativeAfter,
            reason,
          );

    /*
     * The funding split of this refund (20.09.2026). `bonus` here equals the
     * `bonusRestored` the loyalty reversal above computed — same watermark
     * formula on the same column — and is asserted to, because two
     * arithmetics for one number is how drift starts. `prepaid` goes back to
     * the customer's money balance and comes out of the partner's payable
     * (a new posting, never an edit — a refund after the partner was paid
     * leaves a fresh debit for the next settlement or a collection).
     * `external` is what the partner owes the customer in cash: TuTak moves
     * nothing for it and only records whether the partner says it was
     * handed back.
     */
    const split = splitRefundAcrossComponents({
      amount,
      grossAmount: intent.grossAmount,
      bonusAmountRequested: intent.bonusAmountRequested,
      prepaidAmountApplied: intent.prepaidAmountApplied,
      cumulativeBefore,
      cumulativeAfter,
    });
    if (!split.bonus.equals(bonusRestored)) {
      throw new InternalServerErrorException(
        `Purchase intent ${intent.id} refund: bonus slice ${split.bonus.toString()} disagrees with ` +
          `the loyalty reversal's ${bonusRestored.toString()}`,
      );
    }
    if (split.prepaid.greaterThan(0)) {
      await this.customerBalance.refundPrepaidFromPartner(
        {
          userId: intent.customerId,
          partnerId: intent.partnerId,
          amount: split.prepaid,
          purchaseIntentId: intent.id,
        },
        tx,
      );
    }
    const externalRefundStatus = split.external.greaterThan(0)
      ? ExternalRefundStatus.PENDING_PARTNER
      : ExternalRefundStatus.NOT_REQUIRED;

    const refund = await tx.purchaseIntentRefund.create({
      data: {
        purchaseIntentId: intent.id,
        amount,
        bonusRestored,
        prepaidRestored: split.prepaid,
        externalRefundDue: split.external,
        externalRefundStatus,
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
          prepaidRestored: split.prepaid.toString(),
          externalRefundDue: split.external.toString(),
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
      prepaidRestored: split.prepaid.toFixed(MONEY_SCALE),
      externalRefundDue: split.external.toFixed(MONEY_SCALE),
      externalRefundStatus,
    };
  }

  /**
   * Somebody at the business states that the cash/card slice of a refund
   * was handed back to the customer.
   *
   * TuTak cannot know this by itself — the money never passed through it —
   * so the state is a partner's statement, recorded with who made it and
   * when, and nothing more. Until it is made, the refund is *not* complete
   * from the customer's point of view and no screen may say it is (§26).
   * Idempotent: confirming twice is one confirmation.
   */
  async confirmExternalRefund(refundId: string, actorId: string) {
    const refund = await this.prisma.purchaseIntentRefund.findUnique({
      where: { id: refundId },
      include: { purchaseIntent: { select: { partnerId: true, partnerBranchId: true } } },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.externalRefundStatus === ExternalRefundStatus.NOT_REQUIRED) {
      throw new BadRequestException(
        'Nothing was paid at the till for this refund — there is no external part to confirm',
      );
    }
    if (refund.externalRefundStatus === ExternalRefundStatus.CONFIRMED) return refund;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseIntentRefund.updateMany({
        where: { id: refundId, externalRefundStatus: ExternalRefundStatus.PENDING_PARTNER },
        data: {
          externalRefundStatus: ExternalRefundStatus.CONFIRMED,
          externalRefundConfirmedAt: new Date(),
          externalRefundConfirmedByUserId: actorId,
        },
      });
      if (claimed.count === 0) return;
      await this.auditService.record(
        {
          actorUserId: actorId,
          action: AuditAction.PURCHASE_INTENT_REFUNDED,
          entityType: 'PurchaseIntentRefund',
          entityId: refundId,
          metadata: {
            event: 'external_refund_confirmed',
            purchaseIntentId: refund.purchaseIntentId,
            externalRefundDue: refund.externalRefundDue.toString(),
          },
        },
        tx,
      );
    });
    return this.prisma.purchaseIntentRefund.findUniqueOrThrow({ where: { id: refundId } });
  }

  async findRefundOrThrow(refundId: string) {
    const refund = await this.prisma.purchaseIntentRefund.findUnique({
      where: { id: refundId },
      include: { purchaseIntent: { select: { partnerId: true, partnerBranchId: true, customerId: true } } },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  /**
   * LEGACY single-level program only (`programVersion` null) — reverses
   * every loyalty effect this purchase's own confirmation created,
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
   *
   * Untouched by the 2026-08-22 3-level rework — see `reverseLoyaltyEffectsV2`
   * for the current program's own reversal, which never calls this.
   */
  private async reverseLoyaltyEffectsLegacy(
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
      total.lessThanOrEqualTo(0)
        ? new Decimal(0)
        : roundIssued(total.times(cumulative).dividedBy(grossAmount));
    const delta = (total: Decimal): Decimal =>
      shareAt(total, cumulativeAfter).minus(shareAt(total, cumulativeBefore));

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
        const clawed = await this.bonusEngine.reverseAccrualLot(
          referralLot.id,
          reason,
          referrerΔ,
          tx,
        );
        referrerClawed = clawed ?? zero;
      }
    }
    const referrerShortfall = referrer?.type === 'USER' ? referrerΔ.minus(referrerClawed) : zero;

    let deferredLiabilityToReverse = zero;
    let deferredShortfall = zero;
    if (deferredΔ.greaterThan(0)) {
      const result = await this.deferredBonusLots.reverseForRefund(
        sourceTransactionId,
        deferredΔ,
        reason,
        tx,
      );
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
    await this.deferredBonusLots.reverseExternalContributions(
      sourceTransactionId,
      rawRefundΔ,
      reason,
      tx,
    );
    await this.referralService.reverseChallengeContribution(
      sourceTransactionId,
      rawRefundΔ,
      reason,
      tx,
    );

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
      await this.bonusEngine.restoreSpentBonus(
        wallet.id,
        bonusRestoreΔ,
        sourceTransactionId,
        reason,
        tx,
      );
    }

    const ledgerTransactionId = await this.postReversalLedgerLegacy(tx, intent, {
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
   * LEGACY single-level program only — the mirror image of
   * `PurchaseIntentsService.postContributionLedger` + `postRedemptionCompensation`,
   * scaled to this refund's proportional share — never `LedgerService.reverse()`,
   * which flips a transaction's postings verbatim and has no notion of a
   * partial amount.
   *
   * `poolΔ` (what the partner is credited back) always stays the full
   * theoretical merchandise-refund share — the partner's contribution
   * obligation shrinks by exactly the fraction of the sale reversed,
   * regardless of what later happened to the bonus it funded. `greenClawed`
   * / `deferredLiabilityToReverse` / `referrerClawed` are what actually came
   * back from wallets (see `reverseLoyaltyEffectsLegacy`), so `customerLiabilityΔ`
   * can be smaller than the theoretical share; `shortfall` — the difference
   * — is folded into `tutakRevenueΔ` so the posting still balances to
   * `poolΔ` by construction, the same remainder technique `tutakBaseΔ`
   * itself already uses.
   */
  private async postReversalLedgerLegacy(
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
      this.ledger.accountFor(
        { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId },
        tx,
      ),
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
          ? [
              {
                accountId: bonusLiabilityAccount.id,
                direction: PostingDirection.DEBIT,
                amount: customerLiabilityΔ,
              },
            ]
          : []),
        ...(amounts.referrer?.type === 'PARTNER' && amounts.referrerΔ.greaterThan(0)
          ? [
              {
                accountId: (
                  await this.ledger.accountFor(
                    {
                      type: LedgerAccountType.PARTNER_PAYABLE,
                      partnerId: amounts.referrer.partnerId,
                    },
                    tx,
                  )
                ).id,
                direction: PostingDirection.DEBIT,
                amount: amounts.referrerΔ,
              },
            ]
          : []),
        ...(tutakRevenueΔ.greaterThan(0)
          ? [
              {
                accountId: revenueAccount.id,
                direction: PostingDirection.DEBIT,
                amount: tutakRevenueΔ,
              },
            ]
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
            {
              accountId: bonusLiabilityAccount.id,
              direction: PostingDirection.CREDIT,
              amount: amounts.bonusRestoreΔ,
            },
            {
              accountId: partnerAccount.id,
              direction: PostingDirection.DEBIT,
              amount: amounts.bonusRestoreΔ,
            },
          ],
        },
        tx,
      );
    }

    return primaryTransactionId;
  }

  /**
   * THREE_LEVEL_V2 program only (2026-08-22 rework) — the 3-level
   * generalisation of `reverseLoyaltyEffectsLegacy`, same proportional
   * `amount / grossAmount` construction, but reversing up to three referrer
   * legs plus `tutakAmount` instead of one referrer leg plus a residual
   * `tutakBase`.
   *
   * Deliberately reads every referrer level from the `PurchaseIntent`'s own
   * stored snapshot columns (`referrer1..3Type/UserId/PartnerId/Amount`) —
   * never `ReferralService.resolveReferralChain` again. The spec is
   * explicit that a refund/CDR-correction/retry must never re-walk the
   * current chain; the attribution is immutable so re-walking would answer
   * identically today, but reading the snapshot is what makes that
   * guarantee true by construction rather than by coincidence, and is what
   * lets a levels's *type* (a user who later somehow lost their invite row,
   * for instance) never silently change what a historical reversal targets.
   */
  private async reverseLoyaltyEffectsV2(
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
      referrer1Type: ReferrerType | null;
      referrer1UserId: string | null;
      referrer1PartnerId: string | null;
      referrer1Amount: Decimal | null;
      referrer2Type: ReferrerType | null;
      referrer2UserId: string | null;
      referrer2PartnerId: string | null;
      referrer2Amount: Decimal | null;
      referrer3Type: ReferrerType | null;
      referrer3UserId: string | null;
      referrer3PartnerId: string | null;
      referrer3Amount: Decimal | null;
      tutakAmount: Decimal | null;
      sourceTransactionId: string | null;
    },
    cumulativeBefore: Decimal,
    cumulativeAfter: Decimal,
    reason: string,
  ): Promise<{ bonusRestored: Decimal; ledgerTransactionId: string | null; shortfall: Decimal }> {
    const grossAmount = intent.grossAmount;
    const sourceTransactionId = intent.sourceTransactionId!;
    const zero = new Decimal(0);

    const shareAt = (total: Decimal, cumulative: Decimal): Decimal =>
      total.lessThanOrEqualTo(0)
        ? zero
        : roundIssued(total.times(cumulative).dividedBy(grossAmount));
    const delta = (total: Decimal): Decimal =>
      shareAt(total, cumulativeAfter).minus(shareAt(total, cumulativeBefore));

    // Only ever null for an intent whose snapshot was already validated
    // complete by `postRefund` before this is reached.
    const pool = intent.poolAmount ?? zero;
    const green = intent.greenAmount ?? zero;
    const deferred = intent.deferredAmount ?? zero;

    const greenΔ = delta(green);
    const deferredΔ = delta(deferred);
    const bonusRestoreΔ = delta(intent.bonusAmountRequested);

    const levels: SnapshotLevel[] = [
      {
        level: 1,
        type: intent.referrer1Type,
        userId: intent.referrer1UserId,
        partnerId: intent.referrer1PartnerId,
        amountΔ: delta(intent.referrer1Amount ?? zero),
      },
      {
        level: 2,
        type: intent.referrer2Type,
        userId: intent.referrer2UserId,
        partnerId: intent.referrer2PartnerId,
        amountΔ: delta(intent.referrer2Amount ?? zero),
      },
      {
        level: 3,
        type: intent.referrer3Type,
        userId: intent.referrer3UserId,
        partnerId: intent.referrer3PartnerId,
        amountΔ: delta(intent.referrer3Amount ?? zero),
      },
    ];
    // The remainder, exactly like `ReferralService.computePoolSplit`'s own
    // `tutak` — never independently rounded, so all six legs always sum to
    // exactly `poolΔ`.
    const poolΔ = delta(pool);
    const tutakΔ = poolΔ
      .minus(greenΔ)
      .minus(deferredΔ)
      .minus(levels.reduce((s, l) => s.plus(l.amountΔ), zero));

    // Same reasoning as the legacy method: `reverseAccrualLot` claws back
    // only a lot's unspent remainder; whatever the theoretical share could
    // not reclaim is `shortfall`, tracked explicitly rather than assumed.
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

    // Per-level clawback: a USER-type level's share was accrued into their
    // wallet as its own `BonusLot` (keyed by walletId, so a repeated
    // recipient across levels — already impossible by construction, see
    // `resolveReferralChain` — could never collide two levels' lots even if
    // it somehow occurred). A PARTNER-type level never had a wallet lot to
    // begin with — its whole `amountΔ` reverses directly in the ledger step
    // below, mirroring how it was credited directly to their payable.
    const perLevelClawed: Record<1 | 2 | 3, Decimal> = { 1: zero, 2: zero, 3: zero };
    let referrerShortfall = zero;
    for (const lvl of levels) {
      if (lvl.type !== ReferrerType.USER || !lvl.userId || lvl.amountΔ.lessThanOrEqualTo(0))
        continue;
      const wallet = await tx.wallet.findUnique({ where: { userId: lvl.userId } });
      const lot = wallet
        ? await tx.bonusLot.findFirst({
            where: {
              sourceTransactionId,
              type: BonusEntryType.ACCRUAL_REFERRAL,
              walletId: wallet.id,
            },
          })
        : null;
      const clawed = lot
        ? ((await this.bonusEngine.reverseAccrualLot(lot.id, reason, lvl.amountΔ, tx)) ?? zero)
        : zero;
      perLevelClawed[lvl.level] = clawed;
      referrerShortfall = referrerShortfall.plus(lvl.amountΔ.minus(clawed));
    }

    let deferredLiabilityToReverse = zero;
    let deferredShortfall = zero;
    if (deferredΔ.greaterThan(0)) {
      const result = await this.deferredBonusLots.reverseForRefund(
        sourceTransactionId,
        deferredΔ,
        reason,
        tx,
      );
      deferredLiabilityToReverse = result.liabilityToReverse;
      deferredShortfall = result.shortfall;
    }

    // Same as the legacy method: this purchase's own turnover contribution
    // to other deferred lots and to the Referral Challenge (L1-only,
    // unaffected by the 3-level rework — requirement 6) is a straight
    // dollar-for-dollar relationship on the raw refunded amount, not the
    // pool split.
    const rawRefundΔ = cumulativeAfter.minus(cumulativeBefore);
    await this.deferredBonusLots.reverseExternalContributions(
      sourceTransactionId,
      rawRefundΔ,
      reason,
      tx,
    );
    await this.referralService.reverseChallengeContribution(
      sourceTransactionId,
      rawRefundΔ,
      reason,
      tx,
    );

    const shortfall = greenShortfall.plus(referrerShortfall).plus(deferredShortfall);
    if (shortfall.greaterThan(0)) {
      this.logger.warn(
        `Purchase intent ${intent.id} refund (3-level): ${shortfall.toString()} of the earned bonus liability ` +
          'could not be reclaimed from wallets (already spent or expired) and was released to platform revenue.',
      );
    }

    if (bonusRestoreΔ.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: intent.customerId } });
      await this.bonusEngine.restoreSpentBonus(
        wallet.id,
        bonusRestoreΔ,
        sourceTransactionId,
        reason,
        tx,
      );
    }

    const ledgerTransactionId = await this.postReversalLedgerV2(tx, intent, {
      poolΔ,
      greenClawed,
      deferredLiabilityToReverse,
      levels,
      perLevelClawed,
      tutakΔ,
      bonusRestoreΔ,
      shortfall,
    });

    return { bonusRestored: bonusRestoreΔ, ledgerTransactionId, shortfall };
  }

  /**
   * THREE_LEVEL_V2 program only — the mirror image of
   * `PurchaseIntentsService.postContributionLedger`'s 3-level posting,
   * scaled to this refund's proportional share. Same construction as
   * `postReversalLedgerLegacy`: `poolΔ` is the full theoretical share
   * credited back to the partner; each USER-type level's clawed amount (not
   * the theoretical share) reduces `BONUS_LIABILITY`; each PARTNER-type
   * level's full theoretical `amountΔ` reverses directly against their own
   * `PARTNER_PAYABLE` (a partner has no wallet lot to claw back from, so
   * there is no shortfall concept on that leg); and `shortfall` — value a
   * USER-type level could not reclaim — folds into `tutakRevenueΔ` so the
   * posting still balances to `poolΔ` by construction.
   */
  private async postReversalLedgerV2(
    tx: Tx,
    intent: { id: string; partnerId: string },
    amounts: {
      poolΔ: Decimal;
      greenClawed: Decimal;
      deferredLiabilityToReverse: Decimal;
      levels: SnapshotLevel[];
      perLevelClawed: Record<1 | 2 | 3, Decimal>;
      tutakΔ: Decimal;
      bonusRestoreΔ: Decimal;
      shortfall: Decimal;
    },
  ): Promise<string | null> {
    if (amounts.poolΔ.lessThanOrEqualTo(0) && amounts.bonusRestoreΔ.lessThanOrEqualTo(0)) {
      return null;
    }

    const [partnerAccount, bonusLiabilityAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor(
        { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId },
        tx,
      ),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
    ]);

    let primaryTransactionId: string | null = null;

    if (amounts.poolΔ.greaterThan(0)) {
      const userLevelsClawed = amounts.levels
        .filter((l) => l.type === ReferrerType.USER)
        .reduce((s, l) => s.plus(amounts.perLevelClawed[l.level]), new Decimal(0));
      const customerLiabilityΔ = amounts.greenClawed
        .plus(amounts.deferredLiabilityToReverse)
        .plus(userLevelsClawed);
      const tutakRevenueΔ = amounts.tutakΔ.plus(amounts.shortfall);

      const partnerReferrerPostings = await Promise.all(
        amounts.levels
          .filter((l) => l.type === ReferrerType.PARTNER && l.partnerId && l.amountΔ.greaterThan(0))
          .map(async (l) => {
            const account = await this.ledger.accountFor(
              { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: l.partnerId! },
              tx,
            );
            return { accountId: account.id, direction: PostingDirection.DEBIT, amount: l.amountΔ };
          }),
      );

      const postings = [
        { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: amounts.poolΔ },
        ...(customerLiabilityΔ.greaterThan(0)
          ? [
              {
                accountId: bonusLiabilityAccount.id,
                direction: PostingDirection.DEBIT,
                amount: customerLiabilityΔ,
              },
            ]
          : []),
        ...partnerReferrerPostings,
        ...(tutakRevenueΔ.greaterThan(0)
          ? [
              {
                accountId: revenueAccount.id,
                direction: PostingDirection.DEBIT,
                amount: tutakRevenueΔ,
              },
            ]
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
            {
              accountId: bonusLiabilityAccount.id,
              direction: PostingDirection.CREDIT,
              amount: amounts.bonusRestoreΔ,
            },
            {
              accountId: partnerAccount.id,
              direction: PostingDirection.DEBIT,
              amount: amounts.bonusRestoreΔ,
            },
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
    prepaidRestored: Decimal;
    externalRefundDue: Decimal;
    externalRefundStatus: ExternalRefundStatus;
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
        prepaidRestored: refund.prepaidRestored.toFixed(MONEY_SCALE),
        externalRefundDue: refund.externalRefundDue.toFixed(MONEY_SCALE),
        externalRefundStatus: refund.externalRefundStatus,
      }));
  }

  /**
   * Every refund of this partner's sales whose cash slice the business has
   * not yet said it handed back — the till's own to-do list (§26). Branch
   * scoped by the caller's filter, like the purchase queue.
   */
  listPendingExternal(partnerId: string, branchIds: string[] | null) {
    return this.prisma.purchaseIntentRefund.findMany({
      where: {
        externalRefundStatus: ExternalRefundStatus.PENDING_PARTNER,
        purchaseIntent: {
          partnerId,
          ...(branchIds ? { partnerBranchId: { in: branchIds } } : {}),
        },
      },
      include: {
        purchaseIntent: {
          select: { id: true, partnerId: true, partnerBranchId: true, confirmationCode: true, grossAmount: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
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
