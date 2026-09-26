import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  CancellationCostDecision,
  OrderEscalationType,
  PartnerOrderActorType,
  PartnerOrderCancellationRequestStatus as ReqStatus,
  PartnerOrderCancellationStatus,
  PartnerOrderOperationalStatus as Op,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeeShiftService } from '../employee-shifts/employee-shift.service';
import { OrderEscalationService } from './order-escalation.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';
import { PartnerOrderPaymentsService } from './partner-order-payments.service';
import { CANCELLABLE, COST_FREE_CANCELLATION, PartnerOrdersService } from './partner-orders.service';

type Tx = Prisma.TransactionClient;
const ZERO = new Decimal(0);
const ACTIVE: ReqStatus[] = [ReqStatus.AWAITING_PARTNER, ReqStatus.COST_REVIEW];

export interface ClaimCostParams {
  amount: string;
  reason: string;
  evidence?: string;
  evidenceUrls?: string[];
}

export interface DecideCostParams {
  decision: 'APPROVE' | 'REDUCE' | 'REJECT';
  /** REDUCE only: the approved amount, strictly below the claim. */
  approvedAmount?: string;
  note: string;
}

/**
 * Item 8 of the final fixes — a customer may always ask to cancel before
 * receipt, and never pays a fixed or percentage penalty. Only an *actual*
 * partner cost, *disclosed to the customer before they confirmed*
 * (`PartnerOrder.cancellationTerms`), can ever be kept, and only the amount
 * a TuTak admin approves:
 *
 *   request ─(no disclosed terms, or nothing could have been spent yet:
 *            SUBMITTED/SEEN/OUT_OF_STOCK)→ cancelled at once, full refund
 *   request ─(otherwise)→ AWAITING_PARTNER (order: cancellationStatus
 *            REQUESTED; fulfillment and receipt paused)
 *     partner "no costs" | window passes → cancelled, full refund
 *     partner claims amount + reason + evidence → COST_REVIEW
 *       admin approve / reduce / reject → cancelled, the approved amount
 *       kept from real money only (confirmed external cash first, then the
 *       money escrow → PARTNER_PAYABLE), the discount always returned in
 *       full, capped by the real money on the order, no commission or
 *       distribution on it (Arman, 2026-09-26)
 *   customer withdraws before a decision → the order simply goes on.
 *
 * Every step is audited; every transition is a conditional claim.
 */
@Injectable()
export class PartnerOrderCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: PartnerOrdersService,
    private readonly payments: PartnerOrderPaymentsService,
    private readonly shifts: EmployeeShiftService,
    private readonly escalations: OrderEscalationService,
    private readonly notifier: PartnerOrderNotifier,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private audit(tx: Tx, actorUserId: string | null, action: AuditAction, orderId: string, metadata: Record<string, unknown>) {
    return this.auditService.record(
      { actorUserId: actorUserId ?? undefined, action, entityType: 'PartnerOrder', entityId: orderId, metadata },
      tx,
    );
  }

  private activeRequest(tx: Tx, orderId: string) {
    return tx.partnerOrderCancellation.findFirst({ where: { orderId, status: { in: ACTIVE } } });
  }

  /** The customer's "Отменить заказ". Idempotent while a request is open. */
  async request(orderId: string, customerId: string, reason?: string) {
    const order = await this.orders.findByIdOrThrow(orderId);
    // Only the customer who confirmed the order may cancel it: an unclaimed
    // DRAFT belongs to nobody yet and simply expires (7e44ad8).
    if (order.customerId !== customerId) throw new NotFoundException('Order not found');
    if (order.operationalStatus === Op.CANCELLED) return order;
    const why = reason?.trim() || 'customer_cancelled';

    if (order.operationalStatus === Op.DRAFT || COST_FREE_CANCELLATION.includes(order.operationalStatus) || !order.cancellationTerms) {
      await this.prisma.$transaction((tx) =>
        this.orders.cancelInTx(tx, orderId, { type: PartnerOrderActorType.CUSTOMER, userId: customerId }, why, [Op.DRAFT, ...CANCELLABLE]),
      );
      const cancelled = await this.orders.findByIdOrThrow(orderId);
      if (cancelled.submittedAt) await this.notifier.cancelled(cancelled);
      return cancelled;
    }

    if (!CANCELLABLE.includes(order.operationalStatus)) {
      throw new ConflictException('This order was already received — ask for a return instead');
    }
    let created = false;
    await this.prisma.$transaction(async (tx) => {
      const flagged = await tx.partnerOrder.updateMany({
        where: { id: orderId, operationalStatus: { in: CANCELLABLE }, cancellationStatus: PartnerOrderCancellationStatus.NONE },
        data: { cancellationStatus: PartnerOrderCancellationStatus.REQUESTED },
      });
      if (flagged.count === 0) {
        if (await this.activeRequest(tx, orderId)) return; // idempotent
        throw new ConflictException('This order can no longer be cancelled');
      }
      const hours = this.config.get('partnerOrderPolicy.cancellationClaimHours', { infer: true });
      const req = await tx.partnerOrderCancellation.create({
        data: {
          orderId,
          requestedByUserId: customerId,
          reason: why,
          partnerDeadlineAt: new Date(Date.now() + hours * 3_600_000),
        },
      });
      await this.audit(tx, customerId, AuditAction.PARTNER_ORDER_CANCELLATION_REQUESTED, orderId, {
        requestId: req.id,
        reason: why,
        fromStatus: order.operationalStatus,
        partnerDeadlineAt: req.partnerDeadlineAt.toISOString(),
      });
      created = true;
    });
    const updated = await this.orders.findByIdOrThrow(orderId);
    if (created) await this.notifier.cancellationRequested(updated);
    return updated;
  }

  /** The customer changes their mind before a decision — the order goes on as it was. */
  async withdraw(orderId: string, customerId: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUnique({ where: { id: orderId } });
      if (!order || order.customerId !== customerId) throw new NotFoundException('Order not found');
      const req = await this.activeRequest(tx, orderId);
      if (!req) return;
      const claimed = await tx.partnerOrderCancellation.updateMany({
        where: { id: req.id, status: { in: ACTIVE } },
        data: { status: ReqStatus.WITHDRAWN, completedAt: new Date() },
      });
      if (claimed.count === 0) return;
      await tx.partnerOrder.update({ where: { id: orderId }, data: { cancellationStatus: PartnerOrderCancellationStatus.NONE } });
      await this.escalations.resolveTypes(orderId, [OrderEscalationType.CANCELLATION_COST_REVIEW], customerId, tx);
      await this.audit(tx, customerId, AuditAction.PARTNER_ORDER_CANCELLATION_WITHDRAWN, orderId, { requestId: req.id });
    });
    return this.orders.findByIdOrThrow(orderId);
  }

  /** The partner declares it has no costs → cancelled with a full refund. */
  async declareNoCost(orderId: string, staffUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const req = await this.activeRequest(tx, orderId);
      if (!req) throw new ConflictException('There is no cancellation request to answer');
      const claimed = await tx.partnerOrderCancellation.updateMany({
        where: { id: req.id, status: ReqStatus.AWAITING_PARTNER },
        data: {
          status: ReqStatus.COMPLETED,
          decision: CancellationCostDecision.NO_COST,
          decidedByUserId: staffUserId,
          decidedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (claimed.count === 0) throw new ConflictException('This cancellation was already answered');
      await this.orders.cancelInTx(
        tx,
        orderId,
        { type: PartnerOrderActorType.CUSTOMER, userId: req.requestedByUserId },
        req.reason ?? 'customer_cancelled',
        CANCELLABLE,
        { cancellationRequestId: req.id },
      );
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_CANCELLATION_DECIDED, orderId, {
        requestId: req.id,
        decision: CancellationCostDecision.NO_COST,
        approvedCost: '0',
      });
    });
    const order = await this.orders.findByIdOrThrow(orderId);
    await this.notifier.cancelled(order);
    return order;
  }

  /**
   * The partner states an actual cost — amount, reason, evidence — on shift.
   * Nothing is kept yet: a TuTak admin decides.
   */
  async claimCost(orderId: string, staffUserId: string, params: ClaimCostParams) {
    const amount = parsePositiveMoney(params.amount, 'cost amount');
    if (!params.reason?.trim()) throw new BadRequestException('Say what the cost was for');
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
      if (amount.greaterThan(order.totalAmount)) throw new BadRequestException('A cost cannot exceed the order total');
      const req = await this.activeRequest(tx, orderId);
      if (!req) throw new ConflictException('There is no cancellation request to answer');
      const stamp = await this.shifts.stampFor(tx, { userId: staffUserId, partnerId: order.partnerId, branchId: order.branchId });
      const claimed = await tx.partnerOrderCancellation.updateMany({
        where: { id: req.id, status: ReqStatus.AWAITING_PARTNER },
        data: {
          status: ReqStatus.COST_REVIEW,
          claimedCostAmount: amount,
          costReason: params.reason.trim(),
          costEvidence: params.evidence?.trim() || null,
          costEvidenceUrls: params.evidenceUrls ?? [],
          claimedByUserId: staffUserId,
          claimedShiftId: stamp.shiftId,
          claimedAt: new Date(),
        },
      });
      if (claimed.count === 0) throw new ConflictException('This cancellation was already answered');
      await tx.partnerOrder.update({ where: { id: orderId }, data: { cancellationStatus: PartnerOrderCancellationStatus.COST_REVIEW } });
      await this.audit(tx, staffUserId, AuditAction.PARTNER_ORDER_CANCELLATION_COST_CLAIMED, orderId, {
        requestId: req.id,
        claimedCostAmount: amount.toString(),
        reason: params.reason.trim(),
        evidence: params.evidence ?? null,
        evidenceUrls: params.evidenceUrls ?? [],
        shiftId: stamp.shiftId,
        withoutShift: stamp.withoutShift,
      });
    });
    const order = await this.orders.findByIdOrThrow(orderId);
    await this.escalations.raise(order, OrderEscalationType.CANCELLATION_COST_REVIEW, `partner-order.cancellation-cost:${orderId}`);
    await this.notifier.cancellationCostClaimed(order);
    return order;
  }

  /** What an admin may approve at most: the real money on the order (item 8). */
  async costCap(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const real = await this.payments.realMoneyAvailable(tx, orderId);
      return { external: real.external.toFixed(4), money: real.money.toFixed(4), total: real.external.plus(real.money).toFixed(4) };
    });
  }

  /** The TuTak admin decides the claim; the cancellation then executes atomically. */
  async decide(requestId: string, adminUserId: string, params: DecideCostParams) {
    const req = await this.prisma.partnerOrderCancellation.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Cancellation request not found');
    if (!params.note?.trim()) throw new BadRequestException('Record the reason for the decision');
    let orderId = req.orderId;
    let approvedTotal = ZERO;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.partnerOrderCancellation.findUniqueOrThrow({ where: { id: requestId } });
      if (current.status !== ReqStatus.COST_REVIEW || !current.claimedCostAmount) {
        throw new ConflictException('This cancellation is not waiting for a cost decision');
      }
      const claimedAmount = current.claimedCostAmount;
      let approved = ZERO;
      let decision: CancellationCostDecision = CancellationCostDecision.REJECTED;
      if (params.decision === 'APPROVE') {
        approved = claimedAmount;
        decision = CancellationCostDecision.APPROVED;
      } else if (params.decision === 'REDUCE') {
        if (!params.approvedAmount) throw new BadRequestException('A reduced decision needs the approved amount');
        approved = parsePositiveMoney(params.approvedAmount, 'approvedAmount');
        if (!approved.lessThan(claimedAmount)) throw new BadRequestException('A reduced amount must be below the claim');
        decision = CancellationCostDecision.REDUCED;
      }
      const real = await this.payments.realMoneyAvailable(tx, current.orderId);
      const cap = real.external.plus(real.money);
      if (approved.greaterThan(cap)) {
        throw new BadRequestException({
          message: `At most ${cap.toFixed(0)} AMD can be approved — the real money on this order; the rest is never charged to the customer`,
          error: 'COST_EXCEEDS_REAL_MONEY',
        });
      }
      const now = new Date();
      // The claim; the approved amount is written together with how it was
      // funded, below — they always reconcile (CHECK).
      const claimed = await tx.partnerOrderCancellation.updateMany({
        where: { id: requestId, status: ReqStatus.COST_REVIEW },
        data: { decision, decidedByUserId: adminUserId, decidedAt: now, decisionNote: params.note.trim() },
      });
      if (claimed.count === 0) throw new ConflictException('This cancellation was already decided');
      const result = await this.orders.cancelInTx(
        tx,
        current.orderId,
        { type: PartnerOrderActorType.CUSTOMER, userId: current.requestedByUserId },
        current.reason ?? 'customer_cancelled',
        CANCELLABLE,
        { retainCost: approved, cancellationRequestId: requestId },
      );
      await tx.partnerOrderCancellation.update({
        where: { id: requestId },
        data: {
          status: ReqStatus.COMPLETED,
          completedAt: now,
          approvedCostAmount: approved,
          costFromExternal: result.retained?.fromExternal ?? ZERO,
          costFromMoney: result.retained?.fromMoney ?? ZERO,
          costLedgerTransactionId: result.retained?.ledgerTransactionId ?? null,
        },
      });
      await this.escalations.resolveTypes(current.orderId, [OrderEscalationType.CANCELLATION_COST_REVIEW], adminUserId, tx);
      await this.audit(tx, adminUserId, AuditAction.PARTNER_ORDER_CANCELLATION_DECIDED, current.orderId, {
        requestId,
        decision,
        claimedCostAmount: claimedAmount.toString(),
        approvedCost: approved.toString(),
        fromExternal: (result.retained?.fromExternal ?? ZERO).toString(),
        fromMoney: (result.retained?.fromMoney ?? ZERO).toString(),
        note: params.note.trim(),
      });
      orderId = current.orderId;
      approvedTotal = approved;
    });
    const order = await this.orders.findByIdOrThrow(orderId);
    if (approvedTotal.greaterThan(0)) await this.notifier.cancelledWithCost(order);
    else await this.notifier.cancelled(order);
    return this.prisma.partnerOrderCancellation.findUniqueOrThrow({ where: { id: requestId } });
  }

  /** The partner let the window pass without claiming anything → no costs, full refund. */
  async expireUnanswered(now = new Date()): Promise<number> {
    const due = await this.prisma.partnerOrderCancellation.findMany({
      where: { status: ReqStatus.AWAITING_PARTNER, partnerDeadlineAt: { lte: now } },
      take: 200,
    });
    let done = 0;
    for (const req of due) {
      let executed = false;
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.partnerOrderCancellation.updateMany({
          where: { id: req.id, status: ReqStatus.AWAITING_PARTNER, partnerDeadlineAt: { lte: now } },
          data: { status: ReqStatus.COMPLETED, decision: CancellationCostDecision.NO_CLAIM, decidedAt: now, completedAt: now },
        });
        if (claimed.count === 0) return;
        await this.orders.cancelInTx(
          tx,
          req.orderId,
          { type: PartnerOrderActorType.CUSTOMER, userId: req.requestedByUserId },
          req.reason ?? 'customer_cancelled',
          CANCELLABLE,
          { cancellationRequestId: req.id },
        );
        await this.audit(tx, null, AuditAction.PARTNER_ORDER_CANCELLATION_DECIDED, req.orderId, {
          requestId: req.id,
          decision: CancellationCostDecision.NO_CLAIM,
          approvedCost: '0',
        });
        executed = true;
      });
      if (executed) {
        done += 1;
        await this.notifier.cancelled(await this.orders.findByIdOrThrow(req.orderId));
      }
    }
    return done;
  }

  listForReview() {
    return this.prisma.partnerOrderCancellation.findMany({
      where: { status: ReqStatus.COST_REVIEW },
      include: {
        order: {
          include: {
            items: true,
            paymentLegs: true,
            partner: { select: { id: true, displayName: true } },
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
          },
        },
      },
      orderBy: { claimedAt: 'asc' },
    });
  }
}
