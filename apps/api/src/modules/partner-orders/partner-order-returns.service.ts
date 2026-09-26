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
  OrderEscalationType,
  PartnerOrder,
  PartnerOrderActorType,
  PartnerOrderOperationalStatus as Op,
  PartnerOrderPaymentStatus as Pay,
  PartnerOrderReturn,
  PartnerOrderReturnStatus as RS,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { parsePositiveMoney, roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommerceLedgerService } from '../commerce-ledger/commerce-ledger.service';
import {
  CommerceReversalService,
  netShortfall,
  ShortfallBreakdown,
  ShortfallSettlementChanged,
  ShortfallSettlementRequired,
} from '../commission-distribution/commerce-reversal.service';
import { EmployeeShiftService } from '../employee-shifts/employee-shift.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { OrderEscalationService } from './order-escalation.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';

type Tx = Prisma.TransactionClient;
const ZERO = new Decimal(0);

/** A return that is not executed yet blocks every other return on the order. */
const UNEXECUTED: RS[] = [RS.AWAITING_SHORTFALL_SETTLEMENT, RS.MANUAL_REVIEW];

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

type Mode =
  | { kind: 'initial'; params: CreateReturnParams }
  | { kind: 'settle'; row: PartnerOrderReturn; staffUserId: string; expectedCollected: Decimal; expectedFromExternal: Decimal }
  /** Computes the current amounts of an unexecuted return and always rolls back. */
  | { kind: 'preview'; row: PartnerOrderReturn; actorId: string };

function breakdownData(b: ShortfallBreakdown) {
  const moneyNet = b.moneyGross.minus(b.netting.fromMoney);
  const cashNet = b.cashGross.minus(b.netting.fromCash);
  return {
    shortfallAmount: b.customerShortfall,
    tutakMoneyGross: b.moneyGross,
    tutakMoneyRefunded: moneyNet,
    externalRefundGross: b.cashGross,
    externalRefundDue: cashNet,
    shortfallFromMoney: b.netting.fromMoney,
    shortfallFromExternal: b.netting.fromCash,
    shortfallCollected: b.netting.collected,
    recoveredShortfall: b.netting.fromMoney.plus(b.netting.fromCash).plus(b.netting.collected),
    grossRefund: b.moneyGross.plus(b.cashGross),
    netRefund: moneyNet.plus(cashNet),
    referralWithheld: b.referralWithheld,
    expiredWrittenBack: b.expiredWrittenBack,
    revenueReversed: b.revenueReversed,
  };
}

/**
 * Returns after completion (spec §44-47, F6) under the COMMERCE_V2 financial
 * model (Arman, Q8/Q9, 2026-09-26). A return never edits history: it is its
 * own `PartnerOrderReturn` row plus linked postings, proportional to the
 * returned share through cumulative watermarks.
 *
 *  - The distribution is reversed by `CommerceReversalService`: unspent
 *    value clawed back, a USER referrer's spent share withheld from their
 *    future accruals (Q8 — no MANUAL_REVIEW for it any more), a PARTNER
 *    referrer's share reversed from its payable.
 *  - The customer's own already-spent allocation (Q9) is netted: first from
 *    the TuTak money they get back (automatic, one posting shows gross /
 *    net / recovered), then from the external cash the partner hands back,
 *    and any rest is paid at the partner's desk. Whenever anything beyond
 *    the TuTak-money netting is needed the return waits as
 *    AWAITING_SHORTFALL_SETTLEMENT and *nothing moves* until an employee on
 *    shift confirms the cash settlement; a customer who refuses sends it to
 *    MANUAL_REVIEW — never a hidden debt.
 *  - The discount part goes back to the customer's discount balance only;
 *    the TuTak-money part to their money balance only (item 9).
 */
@Injectable()
export class PartnerOrderReturnsService {
  private readonly logger = new Logger(PartnerOrderReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceLedger: CommerceLedgerService,
    private readonly reversal: CommerceReversalService,
    private readonly bonusEngine: BonusEngineService,
    private readonly shifts: EmployeeShiftService,
    private readonly escalations: OrderEscalationService,
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
      const created = await this.runSerializable((tx) => this.execute(tx, { kind: 'initial', params }));
      const order = await this.prisma.partnerOrder.findUniqueOrThrow({ where: { id: params.orderId } });
      if (created.status === RS.COMPLETED) await this.notifier.refundCompleted(order);
      return created;
    } catch (err) {
      if (err instanceof ShortfallSettlementRequired) return this.recordAwaitingSettlement(params, err.breakdown);
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findByKey(params.actorId, params.idempotencyKey);
        if (again) return again;
      }
      throw err;
    }
  }

  /**
   * The one execution path, for a new return and for the settlement of an
   * awaiting one. Throws `ShortfallSettlementRequired` (initial) or
   * `ShortfallSettlementChanged` (settle) to roll everything back.
   */
  private async execute(tx: Tx, mode: Mode): Promise<PartnerOrderReturn> {
    const orderId = mode.kind === 'initial' ? mode.params.orderId : mode.row.orderId;
    const order = await tx.partnerOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.operationalStatus !== Op.COMPLETED) {
      throw new BadRequestException('Only a completed order can be returned — before that it is a cancellation');
    }
    if (order.poolAmount === null || !order.sourceTransactionId || !order.customerId) {
      throw new InternalServerErrorException(`Order ${order.id} has no distribution snapshot — manual reconciliation required`);
    }
    const blocking = await tx.partnerOrderReturn.count({
      where: { orderId: order.id, status: { in: UNEXECUTED }, ...(mode.kind !== 'initial' ? { id: { not: mode.row.id } } : {}) },
    });
    if (blocking > 0) throw new ConflictException('A previous return on this order is still being settled');

    const actorId = mode.kind === 'initial' ? mode.params.actorId : mode.kind === 'settle' ? mode.staffUserId : mode.actorId;
    const actorType = mode.kind === 'initial' ? mode.params.actorType : PartnerOrderActorType.PARTNER;
    const stamp =
      mode.kind !== 'preview' && actorType === PartnerOrderActorType.PARTNER
        ? await this.shifts.stampFor(tx, { userId: actorId, partnerId: order.partnerId, branchId: order.branchId })
        : null;

    const remaining = order.totalAmount.minus(order.refundedAmount);
    if (remaining.lessThanOrEqualTo(0)) throw new BadRequestException('This order has already been returned in full');
    const amount =
      mode.kind !== 'initial'
        ? mode.row.amount
        : mode.params.amount
          ? parsePositiveMoney(mode.params.amount, 'return amount')
          : remaining;
    if (amount.greaterThan(remaining)) {
      throw new BadRequestException(`Return of ${amount.toFixed(0)} exceeds the ${remaining.toFixed(0)} still returnable`);
    }

    const before = order.refundedAmount;
    const after = before.plus(amount);
    // Conditional on the watermark we read: two concurrent partial returns
    // can never both compute their share from the same stale total (§61).
    const claimed = await tx.partnerOrder.updateMany({
      where: { id: order.id, refundedAmount: before, operationalStatus: Op.COMPLETED },
      data: { refundedAmount: after },
    });
    if (claimed.count === 0) throw new ConflictException('This order was changed concurrently — please retry');

    const shareAt = (value: Decimal, cumulative: Decimal) =>
      value.lessThanOrEqualTo(0) ? ZERO : roundIssued(value.times(cumulative).dividedBy(order.totalAmount));
    const delta = (value: Decimal) => shareAt(value, after).minus(shareAt(value, before));
    const discountΔ = delta(order.discountAmount);
    const moneyΔ = delta(order.tutakMoneyAmount);
    const externalΔ = amount.minus(discountΔ).minus(moneyΔ);
    const reason = `partner_order_return: ${mode.kind === 'initial' ? mode.params.reason : mode.row.reason}`;

    // The row first (every posting points back at it); filled in below.
    const row =
      mode.kind !== 'initial'
        ? mode.row
        : await tx.partnerOrderReturn.create({
            data: {
              orderId: order.id,
              amount,
              reason: mode.params.reason,
              status: RS.COMPLETED,
              origin: mode.params.actorType,
              disputeId: mode.params.disputeId,
              requestedByUserId: mode.params.actorId,
              requestedShiftId: stamp?.shiftId ?? null,
              idempotencyKey: mode.params.idempotencyKey,
            },
          });
    const source = { sourceType: 'PartnerOrderReturn', sourceId: row.id };

    const reversed = await this.reversal.reverse(tx, this.snapshotOf(order), before, after, reason, source, actorId);
    const netting = netShortfall(reversed.customerShortfall, moneyΔ, externalΔ);
    const breakdown: ShortfallBreakdown = {
      customerShortfall: reversed.customerShortfall,
      moneyGross: moneyΔ,
      cashGross: externalΔ,
      netting,
      referralWithheld: reversed.referralWithheld,
      expiredWrittenBack: reversed.expiredWrittenBack,
      revenueReversed: reversed.revenueReversed,
    };
    if (mode.kind === 'preview') throw new ShortfallSettlementChanged(breakdown);
    const deskPart = netting.fromCash.plus(netting.collected);
    if (mode.kind === 'initial' && deskPart.greaterThan(0)) throw new ShortfallSettlementRequired(breakdown);
    if (
      mode.kind === 'settle' &&
      (!netting.collected.equals(mode.expectedCollected) || !netting.fromCash.equals(mode.expectedFromExternal))
    ) {
      throw new ShortfallSettlementChanged(breakdown);
    }

    let discountLedgerId: string | null = null;
    if (discountΔ.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.customerId } });
      await this.bonusEngine.restoreSpentBonus(wallet.id, discountΔ, order.sourceTransactionId, reason, tx);
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
      ? await this.commerceLedger.refundMoneyFromPartner(
          order.customerId,
          order.partnerId,
          moneyΔ,
          source,
          'partner_order.return_money',
          tx,
          tx,
          netting.fromMoney,
        )
      : null;
    const deskLedgerId = deskPart.greaterThan(0)
      ? await this.commerceLedger.recoverShortfallViaPartner(
          order.customerId,
          order.partnerId,
          deskPart,
          source,
          'partner_order.shortfall_settled_at_desk',
          tx,
          tx,
        )
      : null;

    const externalNet = externalΔ.minus(netting.fromCash);
    // Settled at the desk = the external hand-back was confirmed with it.
    const status = mode.kind === 'settle' || !externalNet.greaterThan(0) ? RS.COMPLETED : RS.PENDING_EXTERNAL_REFUND;
    const fullyReturned = after.equals(order.totalAmount);
    await tx.partnerOrder.update({
      where: { id: order.id },
      data: {
        paymentStatus: status === RS.PENDING_EXTERNAL_REFUND ? Pay.REFUND_PENDING : fullyReturned ? Pay.REFUNDED : Pay.PARTIALLY_REFUNDED,
      },
    });

    const now = new Date();
    const data = {
      status,
      discountRestored: discountΔ,
      poolReversed: reversed.poolΔ,
      ...breakdownData(breakdown),
      contributionReversalLedgerTransactionId: reversed.contributionLedgerTransactionId,
      discountRefundLedgerTransactionId: discountLedgerId,
      moneyRefundLedgerTransactionId: moneyLedgerId,
      shortfallRecoveryLedgerTransactionId: deskLedgerId,
      completedAt: status === RS.COMPLETED ? now : null,
      ...(mode.kind === 'settle'
        ? {
            settledByUserId: mode.staffUserId,
            settledShiftId: stamp?.shiftId ?? null,
            settledAt: now,
            externalRefundConfirmedByUserId: externalNet.greaterThan(0) ? mode.staffUserId : null,
            externalRefundConfirmedShiftId: externalNet.greaterThan(0) ? (stamp?.shiftId ?? null) : null,
            externalRefundConfirmedAt: externalNet.greaterThan(0) ? now : null,
          }
        : {}),
    };
    let saved: PartnerOrderReturn;
    if (mode.kind === 'settle') {
      const done = await tx.partnerOrderReturn.updateMany({ where: { id: row.id, status: RS.AWAITING_SHORTFALL_SETTLEMENT }, data });
      if (done.count === 0) throw new ConflictException('This return was already settled');
      saved = await tx.partnerOrderReturn.findUniqueOrThrow({ where: { id: row.id } });
    } else {
      saved = await tx.partnerOrderReturn.update({ where: { id: row.id }, data });
    }

    await this.auditService.record(
      {
        actorUserId: actorId,
        action: mode.kind === 'settle' ? AuditAction.PARTNER_ORDER_RETURN_SHORTFALL_SETTLED : AuditAction.PARTNER_ORDER_RETURN_CREATED,
        entityType: 'PartnerOrder',
        entityId: order.id,
        metadata: {
          returnId: saved.id,
          amount: amount.toString(),
          totalReturned: after.toString(),
          poolReversed: reversed.poolΔ.toString(),
          discountRestored: discountΔ.toString(),
          grossRefund: saved.grossRefund.toString(),
          recoveredShortfall: saved.recoveredShortfall.toString(),
          netRefund: saved.netRefund.toString(),
          shortfallCollectedAtDesk: netting.collected.toString(),
          referralWithheld: reversed.referralWithheld.toString(),
          shiftId: stamp?.shiftId ?? null,
          withoutShift: stamp?.withoutShift ?? false,
          disputeId: saved.disputeId,
        },
      },
      tx,
    );
    return saved;
  }

  private snapshotOf(order: PartnerOrder) {
    return {
      base: order.totalAmount,
      poolAmount: order.poolAmount,
      greenAmount: order.greenAmount,
      deferredAmount: order.deferredAmount,
      referrer1Type: order.referrer1Type,
      referrer1UserId: order.referrer1UserId,
      referrer1PartnerId: order.referrer1PartnerId,
      referrer1Amount: order.referrer1Amount,
      referrer2Type: order.referrer2Type,
      referrer2UserId: order.referrer2UserId,
      referrer2PartnerId: order.referrer2PartnerId,
      referrer2Amount: order.referrer2Amount,
      referrer3Type: order.referrer3Type,
      referrer3UserId: order.referrer3UserId,
      referrer3PartnerId: order.referrer3PartnerId,
      referrer3Amount: order.referrer3Amount,
      tutakAmount: order.tutakAmount,
      sourceTransactionId: order.sourceTransactionId!,
      customerId: order.customerId!,
      partnerId: order.partnerId,
    };
  }

  /**
   * Nothing moved: the return is on record with the amounts the partner
   * settles at the desk (Q9). Its own Serializable check stops a second
   * return from racing in while this one waits.
   */
  private async recordAwaitingSettlement(params: CreateReturnParams, b: ShortfallBreakdown) {
    try {
      const row = await this.runSerializable(async (tx) => {
        const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: params.orderId } });
        const blocking = await tx.partnerOrderReturn.count({ where: { orderId: order.id, status: { in: UNEXECUTED } } });
        if (blocking > 0) throw new ConflictException('A previous return on this order is still being settled');
        const remaining = order.totalAmount.minus(order.refundedAmount);
        const amount = params.amount ? parsePositiveMoney(params.amount, 'return amount') : remaining;
        const stamp =
          params.actorType === PartnerOrderActorType.PARTNER
            ? await this.shifts.stampFor(tx, { userId: params.actorId, partnerId: order.partnerId, branchId: order.branchId })
            : null;
        const created = await tx.partnerOrderReturn.create({
          data: {
            orderId: order.id,
            amount,
            reason: params.reason,
            status: RS.AWAITING_SHORTFALL_SETTLEMENT,
            origin: params.actorType,
            disputeId: params.disputeId,
            requestedByUserId: params.actorId,
            requestedShiftId: stamp?.shiftId ?? null,
            idempotencyKey: params.idempotencyKey,
            ...breakdownData(b),
          },
        });
        await this.auditService.record(
          {
            actorUserId: params.actorId,
            action: AuditAction.PARTNER_ORDER_RETURN_CREATED,
            entityType: 'PartnerOrder',
            entityId: order.id,
            metadata: {
              returnId: created.id,
              status: RS.AWAITING_SHORTFALL_SETTLEMENT,
              amount: amount.toString(),
              customerShortfall: b.customerShortfall.toString(),
              nettedFromMoney: b.netting.fromMoney.toString(),
              nettedFromExternal: b.netting.fromCash.toString(),
              toCollectAtDesk: b.netting.collected.toString(),
            },
          },
          tx,
        );
        return created;
      });
      const order = await this.prisma.partnerOrder.findUniqueOrThrow({ where: { id: params.orderId } });
      await this.notifier.returnSettlementRequired(order);
      return row;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findByKey(params.actorId, params.idempotencyKey);
        if (again) return again;
      }
      throw err;
    }
  }

  /**
   * Q9: an employee on shift confirms the cash settlement with the customer
   * exactly as shown — handed back the net external share and collected the
   * rest. The whole return then executes atomically. If the amounts changed
   * meanwhile (the customer spent more of the bonus), nothing moves and the
   * new amounts are returned for a fresh confirmation.
   */
  async settleShortfall(returnId: string, staffUserId: string, confirmedCollected: string) {
    const row = await this.prisma.partnerOrderReturn.findUnique({ where: { id: returnId } });
    if (!row) throw new NotFoundException('Return not found');
    if (row.status === RS.COMPLETED) return row;
    if (row.status !== RS.AWAITING_SHORTFALL_SETTLEMENT) throw new ConflictException('This return is not awaiting a settlement');
    const collected = new Decimal(confirmedCollected);
    if (!collected.equals(row.shortfallCollected)) {
      throw new ConflictException({
        message: `The amount to collect is ${row.shortfallCollected.toFixed(0)} AMD`,
        error: 'SETTLEMENT_AMOUNT_MISMATCH',
      });
    }
    try {
      const saved = await this.runSerializable((tx) =>
        this.execute(tx, {
          kind: 'settle',
          row,
          staffUserId,
          expectedCollected: row.shortfallCollected,
          expectedFromExternal: row.shortfallFromExternal,
        }),
      );
      const order = await this.prisma.partnerOrder.findUniqueOrThrow({ where: { id: row.orderId } });
      await this.notifier.refundCompleted(order);
      return saved;
    } catch (err) {
      if (err instanceof ShortfallSettlementChanged) {
        const updated = await this.prisma.partnerOrderReturn.update({
          where: { id: row.id },
          data: breakdownData(err.breakdown),
        });
        throw new ConflictException({
          message: `The amount to settle changed: collect ${updated.shortfallCollected.toFixed(0)} AMD, hand back ${updated.externalRefundDue.toFixed(0)} AMD`,
          error: 'SETTLEMENT_AMOUNT_CHANGED',
        });
      }
      throw err;
    }
  }

  /**
   * Q9: the customer refuses or disputes the shortfall — recorded by the
   * partner's employee on shift or by the customer themself. No debt is
   * created and nothing moves; a TuTak operator decides.
   */
  async refuseShortfall(returnId: string, actor: { userId: string; type: PartnerOrderActorType }, note: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.partnerOrderReturn.findUnique({ where: { id: returnId }, include: { order: true } });
      if (!row) throw new NotFoundException('Return not found');
      if (actor.type === PartnerOrderActorType.CUSTOMER && row.order.customerId !== actor.userId) {
        throw new NotFoundException('Return not found');
      }
      const stamp =
        actor.type === PartnerOrderActorType.PARTNER
          ? await this.shifts.stampFor(tx, { userId: actor.userId, partnerId: row.order.partnerId, branchId: row.order.branchId })
          : null;
      const now = new Date();
      const claimed = await tx.partnerOrderReturn.updateMany({
        where: { id: returnId, status: RS.AWAITING_SHORTFALL_SETTLEMENT },
        data: {
          status: RS.MANUAL_REVIEW,
          manualReviewReason: 'customer_refused_shortfall',
          refusedByUserId: actor.userId,
          refusedAt: now,
          refusalNote: note,
        },
      });
      if (claimed.count === 0) {
        if (row.status === RS.MANUAL_REVIEW) return;
        throw new ConflictException('This return is not awaiting a settlement');
      }
      await tx.partnerOrder.update({
        where: { id: row.orderId },
        data: { manualReviewAt: now, manualReviewReason: 'return_shortfall_disputed' },
      });
      await this.auditService.record(
        {
          actorUserId: actor.userId,
          action: AuditAction.PARTNER_ORDER_RETURN_SHORTFALL_REFUSED,
          entityType: 'PartnerOrder',
          entityId: row.orderId,
          metadata: { returnId, actorType: actor.type, note, shiftId: stamp?.shiftId ?? null, withoutShift: stamp?.withoutShift ?? false },
        },
        tx,
      );
    });
    const row = await this.prisma.partnerOrderReturn.findUniqueOrThrow({ where: { id: returnId }, include: { order: true } });
    await this.escalations.raise(row.order, OrderEscalationType.RETURN_SHORTFALL_REVIEW, `partner-order.return-shortfall:${returnId}`);
    const { order: _order, ...plain } = row;
    return plain;
  }

  /**
   * The operator's decision on a refused shortfall: WITHDRAW closes the
   * return without executing it (nothing ever moved); REOPEN puts it back to
   * the desk (the customer agreed after all). Nothing else — writing the
   * shortfall off is not a rule anybody agreed to.
   */
  async reviewShortfall(returnId: string, adminUserId: string, decision: 'WITHDRAW' | 'REOPEN', note: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.partnerOrderReturn.findUnique({ where: { id: returnId } });
      if (!row) throw new NotFoundException('Return not found');
      const now = new Date();
      const claimed = await tx.partnerOrderReturn.updateMany({
        where: { id: returnId, status: RS.MANUAL_REVIEW },
        data: {
          status: decision === 'WITHDRAW' ? RS.WITHDRAWN : RS.AWAITING_SHORTFALL_SETTLEMENT,
          reviewedByUserId: adminUserId,
          reviewedAt: now,
          reviewNote: note,
          ...(decision === 'REOPEN' ? { manualReviewReason: null } : {}),
        },
      });
      if (claimed.count === 0) throw new ConflictException('This return is not waiting for a review');
      const stillOpen = await tx.partnerOrderReturn.count({ where: { orderId: row.orderId, status: RS.MANUAL_REVIEW } });
      if (stillOpen === 0) {
        await tx.partnerOrder.updateMany({
          // 'return_shortfall' is the flag the pre-Q9 code (7e44ad8) set on a
          // shortfall return; such a row reaches this review after migration.
          where: { id: row.orderId, manualReviewReason: { in: ['return_shortfall', 'return_shortfall_disputed'] } },
          data: { manualReviewAt: null, manualReviewReason: null },
        });
      }
      await this.escalations.resolveTypes(row.orderId, [OrderEscalationType.RETURN_SHORTFALL_REVIEW], adminUserId, tx);
      await this.auditService.record(
        {
          actorUserId: adminUserId,
          action: AuditAction.PARTNER_ORDER_RETURN_REVIEWED,
          entityType: 'PartnerOrder',
          entityId: row.orderId,
          metadata: { returnId, decision, note },
        },
        tx,
      );
    });
    const reviewed = await this.prisma.partnerOrderReturn.findUniqueOrThrow({ where: { id: returnId } });
    if (decision === 'REOPEN') await this.refreshBreakdown(reviewed, adminUserId);
    return this.prisma.partnerOrderReturn.findUniqueOrThrow({ where: { id: returnId } });
  }

  /**
   * A reopened return goes back to the desk with the amounts as they are
   * now — the customer may have spent more while it was under review, and a
   * row written before Q9 (7e44ad8) carries no breakdown at all. A dry run
   * that always rolls back: nothing moves. Should it fail, the settlement
   * itself still recomputes and reports changed amounts.
   */
  private async refreshBreakdown(row: PartnerOrderReturn, actorId: string) {
    try {
      await this.runSerializable((tx) => this.execute(tx, { kind: 'preview', row, actorId }));
    } catch (err) {
      if (err instanceof ShortfallSettlementChanged) {
        await this.prisma.partnerOrderReturn.updateMany({
          where: { id: row.id, status: RS.AWAITING_SHORTFALL_SETTLEMENT },
          data: breakdownData(err.breakdown),
        });
        return;
      }
      this.logger.warn(`Could not refresh the amounts of reopened return ${row.id}: ${(err as Error).message}`);
    }
  }

  /** The partner confirms it handed the external share back (spec §47). On shift. Idempotent. */
  async confirmExternalRefund(returnId: string, staffUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.partnerOrderReturn.findUnique({ where: { id: returnId }, include: { order: true } });
      if (!row) throw new NotFoundException('Return not found');
      if (row.status === RS.COMPLETED) return;
      const stamp = await this.shifts.stampFor(tx, { userId: staffUserId, partnerId: row.order.partnerId, branchId: row.order.branchId });
      const claimed = await tx.partnerOrderReturn.updateMany({
        where: { id: returnId, status: RS.PENDING_EXTERNAL_REFUND },
        data: {
          status: RS.COMPLETED,
          externalRefundConfirmedByUserId: staffUserId,
          externalRefundConfirmedShiftId: stamp.shiftId,
          externalRefundConfirmedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        if (row.status === RS.AWAITING_SHORTFALL_SETTLEMENT) {
          throw new ConflictException('Settle the shortfall with the customer first — it includes the external refund');
        }
        return;
      }
      const stillPending = await tx.partnerOrderReturn.count({
        where: { orderId: row.orderId, status: RS.PENDING_EXTERNAL_REFUND },
      });
      if (stillPending === 0) {
        const fresh = await tx.partnerOrder.findUniqueOrThrow({ where: { id: row.orderId } });
        await tx.partnerOrder.update({
          where: { id: row.orderId },
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

  listAwaitingReview() {
    return this.prisma.partnerOrderReturn.findMany({
      where: { status: RS.MANUAL_REVIEW },
      include: { order: { select: { id: true, orderNumber: true, partnerId: true, customerId: true, totalAmount: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async runSerializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        if (err instanceof ShortfallSettlementRequired || err instanceof ShortfallSettlementChanged) throw err;
        const code = (err as { code?: string })?.code;
        const message = err instanceof Error ? err.message : '';
        const retryable =
          code === '40001' || code === '40P01' || /write conflict|deadlock|could not serialize|changed concurrently — retry/i.test(message);
        if (!retryable || attempt === maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, Math.floor(2 ** attempt * 5 * (0.5 + Math.random()))));
      }
    }
    throw new Error('runSerializable exhausted retries without a result');
  }
}
