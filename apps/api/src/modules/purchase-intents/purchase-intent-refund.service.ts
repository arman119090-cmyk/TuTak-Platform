import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  BonusEntryType,
  FinancialPolicyVersion,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  PurchaseIntent,
  PurchaseIntentRefund,
  PurchaseIntentRefundStatus as RS,
  PurchaseIntentStatus,
  ReferralProgramVersion,
  ReferrerType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, parsePositiveMoney, roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommerceLedgerService } from '../commerce-ledger/commerce-ledger.service';
import { EmployeeShiftService } from '../employee-shifts/employee-shift.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { ReferralService, ResolvedReferrer } from '../referral/referral.service';
import {
  CommerceReversalService,
  netShortfall,
  ShortfallBreakdown,
  ShortfallSettlementChanged,
  ShortfallSettlementRequired,
} from '../commission-distribution/commerce-reversal.service';

/** A refund not executed yet blocks every other refund on the purchase. */
const UNEXECUTED: RS[] = [RS.AWAITING_SHORTFALL_SETTLEMENT, RS.MANUAL_REVIEW];

type V2Mode =
  | { kind: 'initial'; params: PurchaseIntentRefundParams }
  | { kind: 'settle'; row: PurchaseIntentRefund; staffUserId: string };

/** The Q9 breakdown columns of a `PurchaseIntentRefund` (never one netted figure). */
function breakdownColumns(b: ShortfallBreakdown) {
  const moneyNet = b.moneyGross.minus(b.netting.fromMoney);
  const cashNet = b.cashGross.minus(b.netting.fromCash);
  return {
    tutakMoneyRefunded: moneyNet,
    customerShortfall: b.customerShortfall,
    shortfallFromMoney: b.netting.fromMoney,
    shortfallFromCash: b.netting.fromCash,
    shortfallCollected: b.netting.collected,
    recoveredShortfall: b.netting.fromMoney.plus(b.netting.fromCash).plus(b.netting.collected),
    cashRefundGross: b.cashGross,
    cashRefundNet: cashNet,
    grossRefund: b.moneyGross.plus(b.cashGross),
    netRefund: moneyNet.plus(cashNet),
    referralWithheld: b.referralWithheld,
    expiredWrittenBack: b.expiredWrittenBack,
    revenueReversed: b.revenueReversed,
  };
}

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
  /** COMPLETED, or (COMMERCE_V2 only) AWAITING_SHORTFALL_SETTLEMENT — nothing moved yet. */
  status: RS;
  amount: string;
  /** Total merchandise value refunded against this purchase after this refund, including this one. */
  totalRefunded: string;
  bonusRestored: string;
  /** Q9: gross money owed back, the customer shortfall recovered from it, and what they get. */
  grossRefund: string;
  recoveredShortfall: string;
  netRefund: string;
  tutakMoneyRefunded: string;
  /** The cash the partner hands back (outside TuTak). */
  cashRefundNet: string;
  /** What the customer still pays at the desk before the refund executes. */
  shortfallCollected: string;
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
    private readonly commerceLedger: CommerceLedgerService,
    private readonly shifts: EmployeeShiftService,
    private readonly reversal: CommerceReversalService,
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
      if (err instanceof ShortfallSettlementRequired) return this.recordAwaitingSettlement(params, err.breakdown);
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

    const unexecuted = await tx.purchaseIntentRefund.count({
      where: { purchaseIntentId: intent.id, status: { in: UNEXECUTED } },
    });
    if (unexecuted > 0) throw new ConflictException('A previous refund on this purchase is still being settled');

    // Spec §6: a refund is a cash-desk action — only on an active shift
    // (inside the partner's one-off rollout window, audited as shiftless).
    const stamp = await this.shifts.stampFor(tx, {
      userId: actorId,
      partnerId: intent.partnerId,
      branchId: intent.partnerBranchId,
    });

    // Q9: purchases created under the Commerce v2 financial model follow it;
    // every older purchase keeps the rules it was sold under (snapshot on
    // the row, never a date comparison).
    if (intent.financialPolicyVersion === FinancialPolicyVersion.COMMERCE_V2) {
      if (intent.programVersion !== ReferralProgramVersion.THREE_LEVEL_V2) {
        throw new InternalServerErrorException(`Purchase intent ${intent.id} is COMMERCE_V2 but not THREE_LEVEL_V2 — manual reconciliation required`);
      }
      return this.postRefundV2(tx, intent, amount, stamp, { kind: 'initial', params });
    }

    const cumulativeBefore = intent.refundedAmount;
    const cumulativeAfter = cumulativeBefore.plus(amount);

    await tx.purchaseIntent.update({
      where: { id: intent.id },
      data: { refundedAmount: cumulativeAfter },
    });

    // Partner Commerce v2 (Q1): the proportional slice of the TuTak-money
    // part goes back to the customer's money balance, from the partner's
    // payable (it was released there at confirmation). Same cumulative
    // watermark as every other leg, so a full refund returns exactly the
    // original amount and repeated partial refunds never over-return.
    const moneyAt = (cumulative: Decimal) =>
      roundIssued(intent.tutakMoneyAmount.times(cumulative).dividedBy(intent.grossAmount));
    const moneyΔ = intent.tutakMoneyAmount.greaterThan(0)
      ? moneyAt(cumulativeAfter).minus(moneyAt(cumulativeBefore))
      : new Decimal(0);
    const moneyLedgerTransactionId = moneyΔ.greaterThan(0)
      ? await this.commerceLedger.refundMoneyFromPartner(
          intent.customerId,
          intent.partnerId,
          moneyΔ,
          { sourceType: 'PurchaseIntent', sourceId: intent.id },
          'purchase_intent.money_refund',
          tx,
          tx,
        )
      : null;

    // Dispatch on the persisted eligibility boundary — never on today's
    // config, and never by re-walking the live referral chain (spec:
    // "subsequent refund/CDR/retry must never re-walk the current chain").
    // A THREE_LEVEL_V2 row reverses against its own `referrer1..3Amount`/
    // `tutakAmount` snapshot; a legacy row reverses exactly as it always
    // has, against `referrerAmount`.
    const { bonusRestored, ledgerTransactionId, shortfall } =
      intent.programVersion === ReferralProgramVersion.THREE_LEVEL_V2
        ? await this.reverseLoyaltyEffectsV2(tx, intent, cumulativeBefore, cumulativeAfter, reason)
        : await this.reverseLoyaltyEffectsLegacy(tx, intent, cumulativeBefore, cumulativeAfter, reason);

    // LEGACY_V1: no netting — the customer gets back the gross TuTak-money
    // share and the partner repays the cash share outside TuTak in full.
    const cashΔ = Decimal.max(amount.minus(bonusRestored).minus(moneyΔ), new Decimal(0));
    const refund = await tx.purchaseIntentRefund.create({
      data: {
        purchaseIntentId: intent.id,
        amount,
        bonusRestored,
        tutakMoneyRefunded: moneyΔ,
        moneyLedgerTransactionId,
        shiftId: stamp.shiftId,
        reason,
        ledgerTransactionId,
        actorId,
        idempotencyKey,
        status: RS.COMPLETED,
        financialPolicyVersion: FinancialPolicyVersion.LEGACY_V1,
        cashRefundGross: cashΔ,
        cashRefundNet: cashΔ,
        grossRefund: moneyΔ.plus(cashΔ),
        netRefund: moneyΔ.plus(cashΔ),
        completedAt: new Date(),
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
          tutakMoneyRefunded: moneyΔ.toString(),
          shiftId: stamp.shiftId,
          withoutShift: stamp.withoutShift,
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

    return this.resultOf(refund, cumulativeAfter);
  }

  private resultOf(refund: PurchaseIntentRefund, totalRefunded: Decimal): PurchaseIntentRefundResult {
    return {
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount.toFixed(MONEY_SCALE),
      totalRefunded: totalRefunded.toFixed(MONEY_SCALE),
      bonusRestored: refund.bonusRestored.toFixed(MONEY_SCALE),
      grossRefund: refund.grossRefund.toFixed(MONEY_SCALE),
      recoveredShortfall: refund.recoveredShortfall.toFixed(MONEY_SCALE),
      netRefund: refund.netRefund.toFixed(MONEY_SCALE),
      tutakMoneyRefunded: refund.tutakMoneyRefunded.toFixed(MONEY_SCALE),
      cashRefundNet: refund.cashRefundNet.toFixed(MONEY_SCALE),
      shortfallCollected: refund.shortfallCollected.toFixed(MONEY_SCALE),
    };
  }

  /**
   * COMMERCE_V2 (Arman, Q8/Q9): the distribution is reversed by the shared
   * `CommerceReversalService` (a USER referrer's spent share is withheld
   * from their future accruals, never absorbed); the customer's own spent
   * share is netted from the TuTak money they get back, then from the cash
   * the partner hands back, and any rest is paid at the desk. Whenever the
   * desk is involved the refund waits (`AWAITING_SHORTFALL_SETTLEMENT`) and
   * nothing moves until an employee on shift confirms the settlement.
   */
  private async postRefundV2(
    tx: Tx,
    intent: PurchaseIntent,
    amount: Decimal,
    stamp: { shiftId: string | null; withoutShift: boolean },
    mode: V2Mode,
  ): Promise<PurchaseIntentRefundResult> {
    const actorId = mode.kind === 'initial' ? mode.params.actorId : mode.staffUserId;
    const reasonText = mode.kind === 'initial' ? mode.params.reason : mode.row.reason;
    const before = intent.refundedAmount;
    const after = before.plus(amount);
    const claimed = await tx.purchaseIntent.updateMany({
      where: { id: intent.id, refundedAmount: before, status: PurchaseIntentStatus.CONFIRMED },
      data: { refundedAmount: after },
    });
    if (claimed.count === 0) throw new ConflictException('This purchase was changed concurrently — please retry');

    const shareAt = (value: Decimal, cumulative: Decimal) =>
      value.lessThanOrEqualTo(0) ? new Decimal(0) : roundIssued(value.times(cumulative).dividedBy(intent.grossAmount));
    const delta = (value: Decimal) => shareAt(value, after).minus(shareAt(value, before));
    const bonusRestoreΔ = delta(intent.bonusAmountRequested);
    const moneyΔ = delta(intent.tutakMoneyAmount);
    const cashΔ = amount.minus(bonusRestoreΔ).minus(moneyΔ);

    const row =
      mode.kind === 'settle'
        ? mode.row
        : await tx.purchaseIntentRefund.create({
            data: {
              purchaseIntentId: intent.id,
              amount,
              reason: reasonText,
              actorId,
              idempotencyKey: mode.params.idempotencyKey,
              shiftId: stamp.shiftId,
              status: RS.COMPLETED,
              financialPolicyVersion: FinancialPolicyVersion.COMMERCE_V2,
            },
          });
    const source = { sourceType: 'PurchaseIntentRefund', sourceId: row.id };
    const reversed = await this.reversal.reverse(
      tx,
      {
        base: intent.grossAmount,
        poolAmount: intent.poolAmount,
        greenAmount: intent.greenAmount,
        deferredAmount: intent.deferredAmount,
        referrer1Type: intent.referrer1Type,
        referrer1UserId: intent.referrer1UserId,
        referrer1PartnerId: intent.referrer1PartnerId,
        referrer1Amount: intent.referrer1Amount,
        referrer2Type: intent.referrer2Type,
        referrer2UserId: intent.referrer2UserId,
        referrer2PartnerId: intent.referrer2PartnerId,
        referrer2Amount: intent.referrer2Amount,
        referrer3Type: intent.referrer3Type,
        referrer3UserId: intent.referrer3UserId,
        referrer3PartnerId: intent.referrer3PartnerId,
        referrer3Amount: intent.referrer3Amount,
        tutakAmount: intent.tutakAmount,
        sourceTransactionId: intent.sourceTransactionId!,
        customerId: intent.customerId,
        partnerId: intent.partnerId,
      },
      before,
      after,
      reasonText,
      source,
      actorId,
    );
    const netting = netShortfall(reversed.customerShortfall, moneyΔ, cashΔ);
    const breakdown: ShortfallBreakdown = {
      customerShortfall: reversed.customerShortfall,
      moneyGross: moneyΔ,
      cashGross: cashΔ,
      netting,
      referralWithheld: reversed.referralWithheld,
      expiredWrittenBack: reversed.expiredWrittenBack,
      revenueReversed: reversed.revenueReversed,
    };
    const deskPart = netting.fromCash.plus(netting.collected);
    if (mode.kind === 'initial' && deskPart.greaterThan(0)) throw new ShortfallSettlementRequired(breakdown);
    if (
      mode.kind === 'settle' &&
      (!netting.collected.equals(mode.row.shortfallCollected) || !netting.fromCash.equals(mode.row.shortfallFromCash))
    ) {
      throw new ShortfallSettlementChanged(breakdown);
    }

    if (bonusRestoreΔ.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: intent.customerId } });
      await this.bonusEngine.restoreSpentBonus(wallet.id, bonusRestoreΔ, intent.sourceTransactionId!, reasonText, tx);
      const [payable, liability] = await Promise.all([
        this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId }, tx),
        this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      ]);
      await this.ledger.post(
        {
          kind: 'partner.bonus_redemption_compensation_refund',
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          postings: [
            { accountId: liability.id, direction: PostingDirection.CREDIT, amount: bonusRestoreΔ },
            { accountId: payable.id, direction: PostingDirection.DEBIT, amount: bonusRestoreΔ },
          ],
        },
        tx,
      );
    }
    const moneyLedgerTransactionId = moneyΔ.greaterThan(0)
      ? await this.commerceLedger.refundMoneyFromPartner(
          intent.customerId,
          intent.partnerId,
          moneyΔ,
          source,
          'purchase_intent.money_refund',
          tx,
          tx,
          netting.fromMoney,
        )
      : null;
    if (deskPart.greaterThan(0)) {
      await this.commerceLedger.recoverShortfallViaPartner(
        intent.customerId,
        intent.partnerId,
        deskPart,
        source,
        'purchase_intent.shortfall_settled_at_desk',
        tx,
        tx,
      );
    }

    const now = new Date();
    const data = {
      status: RS.COMPLETED,
      bonusRestored: bonusRestoreΔ,
      moneyLedgerTransactionId,
      ledgerTransactionId: reversed.contributionLedgerTransactionId,
      completedAt: now,
      ...breakdownColumns(breakdown),
      ...(mode.kind === 'settle' ? { settledByUserId: mode.staffUserId, settledShiftId: stamp.shiftId, settledAt: now } : {}),
    };
    let saved: PurchaseIntentRefund;
    if (mode.kind === 'settle') {
      const done = await tx.purchaseIntentRefund.updateMany({ where: { id: row.id, status: RS.AWAITING_SHORTFALL_SETTLEMENT }, data });
      if (done.count === 0) throw new ConflictException('This refund was already settled');
      saved = await tx.purchaseIntentRefund.findUniqueOrThrow({ where: { id: row.id } });
    } else {
      saved = await tx.purchaseIntentRefund.update({ where: { id: row.id }, data });
    }

    await this.auditService.record(
      {
        actorUserId: actorId,
        action: mode.kind === 'settle' ? AuditAction.PURCHASE_INTENT_REFUND_SHORTFALL_SETTLED : AuditAction.PURCHASE_INTENT_REFUNDED,
        entityType: 'PurchaseIntent',
        entityId: intent.id,
        metadata: {
          refundId: saved.id,
          financialPolicyVersion: FinancialPolicyVersion.COMMERCE_V2,
          amount: amount.toString(),
          totalRefunded: after.toString(),
          bonusRestored: bonusRestoreΔ.toString(),
          grossRefund: saved.grossRefund.toString(),
          recoveredShortfall: saved.recoveredShortfall.toString(),
          netRefund: saved.netRefund.toString(),
          collectedAtDesk: netting.collected.toString(),
          referralWithheld: reversed.referralWithheld.toString(),
          shiftId: stamp.shiftId,
          withoutShift: stamp.withoutShift,
          reason: reasonText,
        },
      },
      tx,
    );
    return this.resultOf(saved, after);
  }

  /** Nothing moved: the refund waits for the partner to settle the shortfall at the desk (Q9). */
  private async recordAwaitingSettlement(params: PurchaseIntentRefundParams, b: ShortfallBreakdown): Promise<PurchaseIntentRefundResult> {
    try {
      const row = await this.runSerializable(async (tx) => {
        const intent = await tx.purchaseIntent.findUniqueOrThrow({ where: { id: params.purchaseIntentId } });
        const remaining = intent.grossAmount.minus(intent.refundedAmount);
        const amount = params.amount ? parsePositiveMoney(params.amount, 'refund amount') : remaining;
        const stamp = await this.shifts.stampFor(tx, { userId: params.actorId, partnerId: intent.partnerId, branchId: intent.partnerBranchId });
        const created = await tx.purchaseIntentRefund.create({
          data: {
            purchaseIntentId: intent.id,
            amount,
            reason: params.reason,
            actorId: params.actorId,
            idempotencyKey: params.idempotencyKey,
            shiftId: stamp.shiftId,
            status: RS.AWAITING_SHORTFALL_SETTLEMENT,
            financialPolicyVersion: FinancialPolicyVersion.COMMERCE_V2,
            ...breakdownColumns(b),
          },
        });
        await this.auditService.record(
          {
            actorUserId: params.actorId,
            action: AuditAction.PURCHASE_INTENT_REFUND_PENDING,
            entityType: 'PurchaseIntent',
            entityId: intent.id,
            metadata: {
              refundId: created.id,
              amount: amount.toString(),
              customerShortfall: b.customerShortfall.toString(),
              nettedFromMoney: b.netting.fromMoney.toString(),
              nettedFromCash: b.netting.fromCash.toString(),
              toCollectAtDesk: b.netting.collected.toString(),
            },
          },
          tx,
        );
        return { created, refunded: intent.refundedAmount };
      });
      return this.resultOf(row.created, row.refunded);
    } catch (err) {
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(params.actorId, params.idempotencyKey);
        if (existing) return this.toResult(existing);
      }
      throw err;
    }
  }

  /** Q9: an employee on shift confirms the desk settlement; the refund then executes atomically. */
  async settleShortfall(refundId: string, staffUserId: string, confirmedCollected: string): Promise<PurchaseIntentRefundResult> {
    const row = await this.prisma.purchaseIntentRefund.findUnique({ where: { id: refundId } });
    if (!row) throw new NotFoundException('Refund not found');
    if (row.status === RS.COMPLETED) return this.toResult(row);
    if (row.status !== RS.AWAITING_SHORTFALL_SETTLEMENT) throw new ConflictException('This refund is not awaiting a settlement');
    if (!new Decimal(confirmedCollected).equals(row.shortfallCollected)) {
      throw new ConflictException({ message: `The amount to collect is ${row.shortfallCollected.toFixed(0)} AMD`, error: 'SETTLEMENT_AMOUNT_MISMATCH' });
    }
    try {
      return await this.runSerializable(async (tx) => {
        const intent = await tx.purchaseIntent.findUniqueOrThrow({ where: { id: row.purchaseIntentId } });
        if (intent.status !== PurchaseIntentStatus.CONFIRMED) throw new BadRequestException('Only a confirmed purchase can be refunded');
        const remaining = intent.grossAmount.minus(intent.refundedAmount);
        if (row.amount.greaterThan(remaining)) throw new BadRequestException('This refund no longer fits what remains refundable');
        const stamp = await this.shifts.stampFor(tx, { userId: staffUserId, partnerId: intent.partnerId, branchId: intent.partnerBranchId });
        return this.postRefundV2(tx, intent, row.amount, stamp, { kind: 'settle', row, staffUserId });
      });
    } catch (err) {
      if (err instanceof ShortfallSettlementChanged) {
        const updated = await this.prisma.purchaseIntentRefund.update({ where: { id: row.id }, data: breakdownColumns(err.breakdown) });
        throw new ConflictException({
          message: `The amount to settle changed: collect ${updated.shortfallCollected.toFixed(0)} AMD, hand back ${updated.cashRefundNet.toFixed(0)} AMD`,
          error: 'SETTLEMENT_AMOUNT_CHANGED',
        });
      }
      throw err;
    }
  }

  /** Q9: the customer refuses or disputes — no hidden debt; an operator decides. Nothing moves. */
  async refuseShortfall(refundId: string, actor: { userId: string; isCustomer: boolean }, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.purchaseIntentRefund.findUnique({ where: { id: refundId }, include: { purchaseIntent: true } });
      if (!row) throw new NotFoundException('Refund not found');
      if (actor.isCustomer && row.purchaseIntent.customerId !== actor.userId) throw new NotFoundException('Refund not found');
      const stamp = actor.isCustomer
        ? null
        : await this.shifts.stampFor(tx, { userId: actor.userId, partnerId: row.purchaseIntent.partnerId, branchId: row.purchaseIntent.partnerBranchId });
      const claimed = await tx.purchaseIntentRefund.updateMany({
        where: { id: refundId, status: RS.AWAITING_SHORTFALL_SETTLEMENT },
        data: { status: RS.MANUAL_REVIEW, refusedByUserId: actor.userId, refusedAt: new Date(), refusalNote: note },
      });
      if (claimed.count === 0 && row.status !== RS.MANUAL_REVIEW) throw new ConflictException('This refund is not awaiting a settlement');
      if (claimed.count === 1) {
        await this.auditService.record(
          {
            actorUserId: actor.userId,
            action: AuditAction.PURCHASE_INTENT_REFUND_SHORTFALL_REFUSED,
            entityType: 'PurchaseIntent',
            entityId: row.purchaseIntentId,
            metadata: { refundId, byCustomer: actor.isCustomer, note, shiftId: stamp?.shiftId ?? null },
          },
          tx,
        );
      }
      return tx.purchaseIntentRefund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }

  /** Operator decision: WITHDRAW (never executed) or REOPEN (back to the desk). No write-off. */
  async reviewShortfall(refundId: string, adminUserId: string, decision: 'WITHDRAW' | 'REOPEN', note: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseIntentRefund.updateMany({
        where: { id: refundId, status: RS.MANUAL_REVIEW },
        data: {
          status: decision === 'WITHDRAW' ? RS.WITHDRAWN : RS.AWAITING_SHORTFALL_SETTLEMENT,
          reviewedByUserId: adminUserId,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });
      if (claimed.count === 0) throw new ConflictException('This refund is not waiting for a review');
      const row = await tx.purchaseIntentRefund.findUniqueOrThrow({ where: { id: refundId } });
      await this.auditService.record(
        {
          actorUserId: adminUserId,
          action: AuditAction.PURCHASE_INTENT_REFUND_REVIEWED,
          entityType: 'PurchaseIntent',
          entityId: row.purchaseIntentId,
          metadata: { refundId, decision, note },
        },
        tx,
      );
      return row;
    });
  }

  listAwaitingReview() {
    return this.prisma.purchaseIntentRefund.findMany({
      where: { status: RS.MANUAL_REVIEW },
      include: { purchaseIntent: { select: { id: true, partnerId: true, customerId: true, grossAmount: true } } },
      orderBy: { createdAt: 'asc' },
    });
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
      total.lessThanOrEqualTo(0) ? zero : roundIssued(total.times(cumulative).dividedBy(grossAmount));
    const delta = (total: Decimal): Decimal => shareAt(total, cumulativeAfter).minus(shareAt(total, cumulativeBefore));

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
    const tutakΔ = poolΔ.minus(greenΔ).minus(deferredΔ).minus(levels.reduce((s, l) => s.plus(l.amountΔ), zero));

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
      if (lvl.type !== ReferrerType.USER || !lvl.userId || lvl.amountΔ.lessThanOrEqualTo(0)) continue;
      const wallet = await tx.wallet.findUnique({ where: { userId: lvl.userId } });
      const lot = wallet
        ? await tx.bonusLot.findFirst({
            where: { sourceTransactionId, type: BonusEntryType.ACCRUAL_REFERRAL, walletId: wallet.id },
          })
        : null;
      const clawed = lot ? ((await this.bonusEngine.reverseAccrualLot(lot.id, reason, lvl.amountΔ, tx)) ?? zero) : zero;
      perLevelClawed[lvl.level] = clawed;
      referrerShortfall = referrerShortfall.plus(lvl.amountΔ.minus(clawed));
    }

    let deferredLiabilityToReverse = zero;
    let deferredShortfall = zero;
    if (deferredΔ.greaterThan(0)) {
      const result = await this.deferredBonusLots.reverseForRefund(sourceTransactionId, deferredΔ, reason, tx);
      deferredLiabilityToReverse = result.liabilityToReverse;
      deferredShortfall = result.shortfall;
    }

    // Same as the legacy method: this purchase's own turnover contribution
    // to other deferred lots and to the Referral Challenge (L1-only,
    // unaffected by the 3-level rework — requirement 6) is a straight
    // dollar-for-dollar relationship on the raw refunded amount, not the
    // pool split.
    const rawRefundΔ = cumulativeAfter.minus(cumulativeBefore);
    await this.deferredBonusLots.reverseExternalContributions(sourceTransactionId, rawRefundΔ, reason, tx);
    await this.referralService.reverseChallengeContribution(sourceTransactionId, rawRefundΔ, reason, tx);

    const shortfall = greenShortfall.plus(referrerShortfall).plus(deferredShortfall);
    if (shortfall.greaterThan(0)) {
      this.logger.warn(
        `Purchase intent ${intent.id} refund (3-level): ${shortfall.toString()} of the earned bonus liability ` +
          'could not be reclaimed from wallets (already spent or expired) and was released to platform revenue.',
      );
    }

    if (bonusRestoreΔ.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: intent.customerId } });
      await this.bonusEngine.restoreSpentBonus(wallet.id, bonusRestoreΔ, sourceTransactionId, reason, tx);
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
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
    ]);

    let primaryTransactionId: string | null = null;

    if (amounts.poolΔ.greaterThan(0)) {
      const userLevelsClawed = amounts.levels
        .filter((l) => l.type === ReferrerType.USER)
        .reduce((s, l) => s.plus(amounts.perLevelClawed[l.level]), new Decimal(0));
      const customerLiabilityΔ = amounts.greenClawed.plus(amounts.deferredLiabilityToReverse).plus(userLevelsClawed);
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
          ? [{ accountId: bonusLiabilityAccount.id, direction: PostingDirection.DEBIT, amount: customerLiabilityΔ }]
          : []),
        ...partnerReferrerPostings,
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

  private toResult(refund: PurchaseIntentRefund): Promise<PurchaseIntentRefundResult> {
    // Re-read rather than trust a stored snapshot: other refunds may have
    // landed against this purchase since, same reasoning as
    // RefundEngineService.toResult.
    return this.prisma.purchaseIntent
      .findUniqueOrThrow({ where: { id: refund.purchaseIntentId } })
      .then((intent) => this.resultOf(refund, intent.refundedAmount));
  }

  async findRefundOrThrow(refundId: string) {
    const refund = await this.prisma.purchaseIntentRefund.findUnique({ where: { id: refundId } });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
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
        if (err instanceof ShortfallSettlementRequired || err instanceof ShortfallSettlementChanged) throw err;
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
