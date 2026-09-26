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
  LedgerAccountType,
  PartnerOrderActorType,
  PartnerOrderOperationalStatus as Op,
  PartnerOrderPaymentStatus as Pay,
  PartnerOrderReturnStatus,
  PostingDirection,
  Prisma,
  ReferrerType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { parsePositiveMoney, roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommerceLedgerService } from '../commerce-ledger/commerce-ledger.service';
import { EmployeeShiftService } from '../employee-shifts/employee-shift.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';

type Tx = Prisma.TransactionClient;
const ZERO = new Decimal(0);

/** Thrown inside the transaction to roll it back when a return would leave an unrecoverable shortfall. */
class ShortfallDetected extends Error {
  constructor(readonly shortfall: Decimal, readonly breakdown: Record<string, string>) {
    super('shortfall');
  }
}

export interface CreateReturnParams {
  orderId: string;
  /** Merchandise value returned. Omit for "everything still returnable". */
  amount?: string;
  reason: string;
  actorId: string;
  actorType: PartnerOrderActorType;
  idempotencyKey: string;
  disputeId?: string;
}

/**
 * Returns after completion (spec §44-47, F6). A return never edits history:
 * it is its own `PartnerOrderReturn` row plus linked reversal postings,
 * proportional to the returned share `r = amount / total`, computed as the
 * difference between cumulative watermarks (so repeated partial returns can
 * never over-reverse, and a full return reverses exactly the original):
 *
 *  - the distribution — green, black (deferred), each referral level and
 *    TuTak's share — reversed from the order's own snapshot, never from
 *    the live chain or today's policy (same construction as
 *    `PurchaseIntentRefundService`'s THREE_LEVEL_V2 path);
 *  - the discount part: restored to the customer's green balance, and the
 *    partner hands back the compensation it had for it
 *    (PARTNER_PAYABLE → BONUS_LIABILITY);
 *  - the TuTak-money part: back to the customer's money balance
 *    (PARTNER_PAYABLE → CUSTOMER_PREPAID_BALANCE);
 *  - the external part: TuTak never had that money (spec §47) — the partner
 *    refunds it and confirms in TuTak (PENDING_EXTERNAL_REFUND).
 *
 * Shortfall (Q7a, Q8/Q9 pending): if any part of the distribution was
 * already spent and cannot be clawed back, this deliberately does *not*
 * copy the QR flow's "TuTak absorbs it" — nothing moves at all, the return
 * is recorded as MANUAL_REVIEW, and a TuTak operator decides once Arman has
 * answered Q8/Q9. No negative balance, no invented debt.
 */
@Injectable()
export class PartnerOrderReturnsService {
  private readonly logger = new Logger(PartnerOrderReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly commerceLedger: CommerceLedgerService,
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly referralService: ReferralService,
    private readonly shifts: EmployeeShiftService,
    private readonly auditService: AuditService,
    private readonly notifier: PartnerOrderNotifier,
  ) {}

  private findByKey(actorId: string, idempotencyKey: string) {
    return this.prisma.partnerOrderReturn.findUnique({
      where: { requestedByUserId_idempotencyKey: { requestedByUserId: actorId, idempotencyKey } },
    });
  }

  async createReturn(params: CreateReturnParams) {
    const existing = await this.findByKey(params.actorId, params.idempotencyKey);
    if (existing) return existing;

    try {
      const created = await this.runSerializable((tx) => this.postReturn(tx, params));
      const order = await this.prisma.partnerOrder.findUniqueOrThrow({ where: { id: params.orderId } });
      if (created.status === PartnerOrderReturnStatus.COMPLETED) await this.notifier.refundCompleted(order);
      return created;
    } catch (err) {
      if (err instanceof ShortfallDetected) {
        return this.recordManualReview(params, err);
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findByKey(params.actorId, params.idempotencyKey);
        if (again) return again;
      }
      throw err;
    }
  }

  private async postReturn(tx: Tx, params: CreateReturnParams) {
    const order = await tx.partnerOrder.findUnique({ where: { id: params.orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.operationalStatus !== Op.COMPLETED) {
      throw new BadRequestException('Only a completed order can be returned — before that it is a cancellation');
    }
    if (
      order.poolAmount === null ||
      order.greenAmount === null ||
      order.deferredAmount === null ||
      order.tutakAmount === null ||
      !order.sourceTransactionId ||
      !order.customerId
    ) {
      throw new InternalServerErrorException(`Order ${order.id} has no distribution snapshot — manual reconciliation required`);
    }
    const blocking = await tx.partnerOrderReturn.count({
      where: { orderId: order.id, status: PartnerOrderReturnStatus.MANUAL_REVIEW },
    });
    if (blocking > 0) throw new ConflictException('A previous return on this order is waiting for manual review');

    const stamp =
      params.actorType === PartnerOrderActorType.PARTNER
        ? await this.shifts.stampFor(tx, { userId: params.actorId, partnerId: order.partnerId, branchId: order.branchId })
        : null;

    const remaining = order.totalAmount.minus(order.refundedAmount);
    if (remaining.lessThanOrEqualTo(0)) throw new BadRequestException('This order has already been returned in full');
    const amount = params.amount ? parsePositiveMoney(params.amount, 'return amount') : remaining;
    if (amount.greaterThan(remaining)) {
      throw new BadRequestException(`Return of ${amount.toFixed(0)} exceeds the ${remaining.toFixed(0)} still returnable`);
    }

    const before = order.refundedAmount;
    const after = before.plus(amount);
    // The claim: conditional on the refunded total we read, so two
    // concurrent partial returns can never both compute their share from
    // the same stale watermark ("partial refund repeated twice", §61) —
    // Serializable isolation retries the loser.
    const claimed = await tx.partnerOrder.updateMany({
      where: { id: order.id, refundedAmount: before, operationalStatus: Op.COMPLETED },
      data: { refundedAmount: after },
    });
    if (claimed.count === 0) throw new ConflictException('This order was changed concurrently — please retry');

    const total = order.totalAmount;
    const shareAt = (value: Decimal | null, cumulative: Decimal) =>
      !value || value.lessThanOrEqualTo(0) ? ZERO : roundIssued(value.times(cumulative).dividedBy(total));
    const delta = (value: Decimal | null) => shareAt(value, after).minus(shareAt(value, before));

    const poolΔ = delta(order.poolAmount);
    const greenΔ = delta(order.greenAmount);
    const deferredΔ = delta(order.deferredAmount);
    const levels = [
      { level: 1 as const, type: order.referrer1Type, userId: order.referrer1UserId, partnerId: order.referrer1PartnerId, amountΔ: delta(order.referrer1Amount) },
      { level: 2 as const, type: order.referrer2Type, userId: order.referrer2UserId, partnerId: order.referrer2PartnerId, amountΔ: delta(order.referrer2Amount) },
      { level: 3 as const, type: order.referrer3Type, userId: order.referrer3UserId, partnerId: order.referrer3PartnerId, amountΔ: delta(order.referrer3Amount) },
    ];
    const tutakΔ = poolΔ.minus(greenΔ).minus(deferredΔ).minus(levels.reduce((s, l) => s.plus(l.amountΔ), ZERO));
    const discountΔ = delta(order.discountAmount);
    const moneyΔ = delta(order.tutakMoneyAmount);
    const externalΔ = amount.minus(discountΔ).minus(moneyΔ);
    const sourceTransactionId = order.sourceTransactionId;
    const reason = `partner_order_return: ${params.reason}`;

    // Claw back every customer/referrer allocation. `reverseAccrualLot` and
    // `reverseForRefund` only ever take what is unspent — anything they
    // cannot take is a shortfall.
    let greenClawed = ZERO;
    if (greenΔ.greaterThan(0)) {
      const lot = await tx.bonusLot.findFirst({ where: { sourceTransactionId, type: BonusEntryType.ACCRUAL_PURCHASE } });
      greenClawed = lot ? ((await this.bonusEngine.reverseAccrualLot(lot.id, reason, greenΔ, tx)) ?? ZERO) : ZERO;
    }
    let referrerShortfall = ZERO;
    const perLevelClawed: Record<1 | 2 | 3, Decimal> = { 1: ZERO, 2: ZERO, 3: ZERO };
    for (const lvl of levels) {
      if (lvl.type !== ReferrerType.USER || !lvl.userId || lvl.amountΔ.lessThanOrEqualTo(0)) continue;
      const wallet = await tx.wallet.findUnique({ where: { userId: lvl.userId } });
      const lot = wallet
        ? await tx.bonusLot.findFirst({ where: { sourceTransactionId, type: BonusEntryType.ACCRUAL_REFERRAL, walletId: wallet.id } })
        : null;
      const clawed = lot ? ((await this.bonusEngine.reverseAccrualLot(lot.id, reason, lvl.amountΔ, tx)) ?? ZERO) : ZERO;
      perLevelClawed[lvl.level] = clawed;
      referrerShortfall = referrerShortfall.plus(lvl.amountΔ.minus(clawed));
    }
    let deferredLiability = ZERO;
    let deferredShortfall = ZERO;
    if (deferredΔ.greaterThan(0)) {
      const result = await this.deferredBonusLots.reverseForRefund(sourceTransactionId, deferredΔ, reason, tx);
      deferredLiability = result.liabilityToReverse;
      deferredShortfall = result.shortfall;
    }
    const greenShortfall = greenΔ.minus(greenClawed);
    const shortfall = greenShortfall.plus(referrerShortfall).plus(deferredShortfall);
    if (shortfall.greaterThan(0)) {
      // Q7a: never silently a TuTak expense, never a negative balance — roll
      // everything above back and hand it to a human.
      throw new ShortfallDetected(shortfall, {
        green: greenShortfall.toFixed(4),
        referral: referrerShortfall.toFixed(4),
        deferred: deferredShortfall.toFixed(4),
        amount: amount.toFixed(4),
      });
    }

    await this.deferredBonusLots.reverseExternalContributions(sourceTransactionId, amount, reason, tx);
    await this.referralService.reverseChallengeContribution(sourceTransactionId, amount, reason, tx);

    const returnRow = await tx.partnerOrderReturn.create({
      data: {
        orderId: order.id,
        amount,
        reason: params.reason,
        status: externalΔ.greaterThan(0) ? PartnerOrderReturnStatus.PENDING_EXTERNAL_REFUND : PartnerOrderReturnStatus.COMPLETED,
        origin: params.actorType,
        disputeId: params.disputeId,
        discountRestored: discountΔ,
        tutakMoneyRefunded: moneyΔ,
        externalRefundDue: externalΔ,
        poolReversed: poolΔ,
        requestedByUserId: params.actorId,
        requestedShiftId: stamp?.shiftId ?? null,
        idempotencyKey: params.idempotencyKey,
        completedAt: externalΔ.greaterThan(0) ? null : new Date(),
      },
    });
    const source = { sourceType: 'PartnerOrderReturn', sourceId: returnRow.id };

    const contributionId = poolΔ.greaterThan(0)
      ? await this.postContributionReversal(tx, order.partnerId, source, {
          poolΔ,
          customerLiabilityΔ: greenClawed
            .plus(deferredLiability)
            .plus(levels.filter((l) => l.type === ReferrerType.USER).reduce((s, l) => s.plus(perLevelClawed[l.level]), ZERO)),
          partnerLevels: levels.filter((l) => l.type === ReferrerType.PARTNER && l.partnerId && l.amountΔ.greaterThan(0)),
          tutakΔ,
        })
      : null;

    let discountLedgerId: string | null = null;
    if (discountΔ.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.customerId } });
      await this.bonusEngine.restoreSpentBonus(wallet.id, discountΔ, sourceTransactionId, reason, tx);
      discountLedgerId = await this.commerceLedger.refundDiscountFromPartner(
        order.partnerId,
        discountΔ,
        source,
        'partner_order.return_discount',
        tx,
        tx,
      );
    }
    const moneyLedgerId = moneyΔ.greaterThan(0)
      ? await this.commerceLedger.refundMoneyFromPartner(order.customerId, order.partnerId, moneyΔ, source, 'partner_order.return_money', tx, tx)
      : null;

    const fullyReturned = after.equals(total);
    await tx.partnerOrder.update({
      where: { id: order.id },
      data: {
        paymentStatus: externalΔ.greaterThan(0) ? Pay.REFUND_PENDING : fullyReturned ? Pay.REFUNDED : Pay.PARTIALLY_REFUNDED,
      },
    });
    const saved = await tx.partnerOrderReturn.update({
      where: { id: returnRow.id },
      data: {
        contributionReversalLedgerTransactionId: contributionId,
        discountRefundLedgerTransactionId: discountLedgerId,
        moneyRefundLedgerTransactionId: moneyLedgerId,
      },
    });
    await this.auditService.record(
      {
        actorUserId: params.actorId,
        action: AuditAction.PARTNER_ORDER_RETURN_CREATED,
        entityType: 'PartnerOrder',
        entityId: order.id,
        metadata: {
          returnId: saved.id,
          amount: amount.toString(),
          totalReturned: after.toString(),
          poolReversed: poolΔ.toString(),
          discountRestored: discountΔ.toString(),
          tutakMoneyRefunded: moneyΔ.toString(),
          externalRefundDue: externalΔ.toString(),
          shiftId: stamp?.shiftId ?? null,
          withoutShift: stamp?.withoutShift ?? false,
          disputeId: params.disputeId ?? null,
        },
      },
      tx,
    );
    return saved;
  }

  /**
   * The mirror of `CommissionDistributionService`'s contribution posting,
   * for this return's share: the partner gets its pool share back (CREDIT
   * PARTNER_PAYABLE), funded by what was clawed from customers' and user
   * referrers' wallets (DEBIT BONUS_LIABILITY), each partner referrer's
   * payable, and TuTak's own revenue share. No shortfall term — a shortfall
   * never reaches this point.
   */
  private async postContributionReversal(
    tx: Tx,
    partnerId: string,
    source: { sourceType: string; sourceId: string },
    amounts: {
      poolΔ: Decimal;
      customerLiabilityΔ: Decimal;
      partnerLevels: { partnerId: string | null; amountΔ: Decimal }[];
      tutakΔ: Decimal;
    },
  ) {
    const [payable, liability, revenue] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
    ]);
    const partnerLegs = await Promise.all(
      amounts.partnerLevels.map(async (l) => {
        const account = await this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: l.partnerId! }, tx);
        return { accountId: account.id, direction: PostingDirection.DEBIT, amount: l.amountΔ };
      }),
    );
    const posted = await this.ledger.post(
      {
        kind: 'partner.contribution_refund',
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        postings: [
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: amounts.poolΔ },
          ...(amounts.customerLiabilityΔ.greaterThan(0)
            ? [{ accountId: liability.id, direction: PostingDirection.DEBIT, amount: amounts.customerLiabilityΔ }]
            : []),
          ...partnerLegs,
          ...(amounts.tutakΔ.greaterThan(0) ? [{ accountId: revenue.id, direction: PostingDirection.DEBIT, amount: amounts.tutakΔ }] : []),
        ],
      },
      tx,
    );
    return posted.id;
  }

  /** Nothing moved; the request is on record for a TuTak operator (pending Q8/Q9). */
  private async recordManualReview(params: CreateReturnParams, detected: ShortfallDetected) {
    const order = await this.prisma.partnerOrder.findUniqueOrThrow({ where: { id: params.orderId } });
    const amount = params.amount ? parsePositiveMoney(params.amount, 'return amount') : order.totalAmount.minus(order.refundedAmount);
    try {
      const row = await this.prisma.partnerOrderReturn.create({
        data: {
          orderId: order.id,
          amount,
          reason: params.reason,
          status: PartnerOrderReturnStatus.MANUAL_REVIEW,
          origin: params.actorType,
          disputeId: params.disputeId,
          shortfallAmount: detected.shortfall,
          manualReviewReason: `unrecoverable_distribution_shortfall ${JSON.stringify(detected.breakdown)}`,
          requestedByUserId: params.actorId,
          idempotencyKey: params.idempotencyKey,
        },
      });
      await this.prisma.partnerOrder.update({
        where: { id: order.id },
        data: { manualReviewAt: new Date(), manualReviewReason: 'return_shortfall' },
      });
      await this.auditService.record({
        actorUserId: params.actorId,
        action: AuditAction.PARTNER_ORDER_MANUAL_REVIEW,
        entityType: 'PartnerOrder',
        entityId: order.id,
        metadata: { returnId: row.id, reason: 'return_shortfall', ...detected.breakdown },
      });
      this.logger.warn(`Return on order ${order.id} needs manual review: shortfall ${detected.shortfall.toFixed(4)}`);
      return row;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findByKey(params.actorId, params.idempotencyKey);
        if (again) return again;
      }
      throw err;
    }
  }

  /** The partner confirms it handed the external share back (spec §47). On shift. Idempotent. */
  async confirmExternalRefund(returnId: string, staffUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.partnerOrderReturn.findUnique({ where: { id: returnId }, include: { order: true } });
      if (!row) throw new NotFoundException('Return not found');
      if (row.status === PartnerOrderReturnStatus.COMPLETED) return;
      const stamp = await this.shifts.stampFor(tx, { userId: staffUserId, partnerId: row.order.partnerId, branchId: row.order.branchId });
      const claimed = await tx.partnerOrderReturn.updateMany({
        where: { id: returnId, status: PartnerOrderReturnStatus.PENDING_EXTERNAL_REFUND },
        data: {
          status: PartnerOrderReturnStatus.COMPLETED,
          externalRefundConfirmedByUserId: staffUserId,
          externalRefundConfirmedShiftId: stamp.shiftId,
          externalRefundConfirmedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (claimed.count === 0) return;
      const stillPending = await tx.partnerOrderReturn.count({
        where: { orderId: row.orderId, status: PartnerOrderReturnStatus.PENDING_EXTERNAL_REFUND },
      });
      if (stillPending === 0) {
        const order = row.order;
        const fresh = await tx.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
        await tx.partnerOrder.update({
          where: { id: order.id },
          data: { paymentStatus: fresh.refundedAmount.equals(fresh.totalAmount) ? Pay.REFUNDED : Pay.PARTIALLY_REFUNDED },
        });
      }
      await this.auditService.record(
        {
          actorUserId: staffUserId,
          action: AuditAction.PARTNER_ORDER_RETURN_COMPLETED,
          entityType: 'PartnerOrder',
          entityId: row.orderId,
          metadata: { returnId, externalRefund: row.externalRefundDue.toString(), shiftId: stamp.shiftId, withoutShift: stamp.withoutShift },
        },
        tx,
      );
    });
    return this.prisma.partnerOrderReturn.findUniqueOrThrow({ where: { id: returnId } });
  }

  listForOrder(orderId: string) {
    return this.prisma.partnerOrderReturn.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  private async runSerializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        if (err instanceof ShortfallDetected) throw err;
        const code = (err as { code?: string })?.code;
        const message = err instanceof Error ? err.message : '';
        const retryable = code === '40001' || code === '40P01' || /write conflict|deadlock|could not serialize/i.test(message);
        if (!retryable || attempt === maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, Math.floor(2 ** attempt * 5 * (0.5 + Math.random()))));
      }
    }
    throw new Error('runSerializable exhausted retries without a result');
  }
}
