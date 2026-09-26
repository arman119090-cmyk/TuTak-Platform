import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  OrderDisputeStatus,
  OrderDisputeType,
  PartnerOrderActorType,
  PartnerOrderDisputeStatus,
  PartnerOrderOperationalStatus as Op,
  PaymentLegStatus,
  PaymentLegType,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { parsePositiveMoney, roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommerceLedgerService } from '../commerce-ledger/commerce-ledger.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';
import { PartnerOrderReturnsService } from './partner-order-returns.service';
import { DISPUTABLE, PartnerOrdersService, RECEIPT_ALLOWED_FROM } from './partner-orders.service';

const ZERO = new Decimal(0);

export interface OpenDisputeParams {
  orderId: string;
  type: OrderDisputeType;
  reason: string;
  description?: string;
  disputedAmount?: string;
  actorId: string;
  actorType: PartnerOrderActorType;
}

export interface ResolveDisputeParams {
  outcome: 'RESOLVED_CUSTOMER' | 'RESOLVED_PARTNER' | 'RESOLVED_SPLIT';
  /** The amount returned to the customer (RESOLVED_CUSTOMER / RESOLVED_SPLIT). */
  customerRefundAmount?: string;
  note: string;
}

/**
 * Manual dispute workflow (spec §29, §48-49). Neither the customer nor the
 * partner can change a financial status through a dispute; only a TuTak
 * admin with ORDER_DISPUTE_RESOLVE decides, and every decision is audited.
 *
 * Money (spec §49):
 *  - ORDER dispute on a completed order whose partner credit has not yet
 *    reached a settlement statement → that credit (the order's electronic
 *    receivable net of its pool, pro rata to the disputed amount) is moved
 *    PARTNER_PAYABLE → PARTNER_DISPUTE_HOLD: frozen, out of any payout.
 *  - Already settled → nothing is frozen; a customer-favourable resolution
 *    runs as a return against PARTNER_PAYABLE, which may go positive —
 *    the partner's debt to TuTak, carried into the next statement.
 *  - Before completion the escrow is still held, so nothing to freeze;
 *    completion simply waits for the dispute (`tryComplete`).
 *  - PAYMENT disputes (spec §27-28) freeze nothing and move nothing
 *    automatically: the risk of a mistaken cash confirmation is the
 *    partner's by default, and TuTak never debits the customer on a
 *    partner's say-so.
 *
 * At most one OPEN dispute per order (partial unique index), and resolution
 * is a conditional claim on OPEN — two admins resolving at once produce one
 * decision (§61).
 */
@Injectable()
export class OrderDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceLedger: CommerceLedgerService,
    private readonly orders: PartnerOrdersService,
    private readonly returns: PartnerOrderReturnsService,
    private readonly auditService: AuditService,
    private readonly notifier: PartnerOrderNotifier,
  ) {}

  /** Has this order's partner credit already been through a settlement statement? */
  private async isSettled(tx: Prisma.TransactionClient, orderId: string, completionLedgerTransactionId: string | null) {
    if (!completionLedgerTransactionId) return false;
    const line = await tx.partnerSettlementStatementLine.findFirst({
      where: { ledgerTransactionId: completionLedgerTransactionId },
      select: { id: true },
    });
    return line !== null || (await tx.partnerSettlementStatementLine.count({ where: { sourceType: 'PartnerOrder', sourceId: orderId } })) > 0;
  }

  async open(params: OpenDisputeParams) {
    const order = await this.orders.findByIdOrThrow(params.orderId);
    if (params.type === OrderDisputeType.ORDER) {
      // Spec §48: once the goods left the partner (to its courier or to the customer).
      if (!DISPUTABLE.includes(order.operationalStatus)) {
        throw new BadRequestException('An order dispute can be opened once the order has left the partner');
      }
    } else if (!DISPUTABLE.includes(order.operationalStatus)) {
      // Before handover a mistaken confirmation is corrected, not disputed (spec §27).
      throw new BadRequestException('Before handover, correct the payment confirmation instead');
    }
    if (params.actorType === PartnerOrderActorType.CUSTOMER && order.customerId !== params.actorId) {
      throw new NotFoundException('Order not found');
    }
    if (params.type === OrderDisputeType.PAYMENT) {
      const confirmedExternal = order.paymentLegs.some((l) => l.type === PaymentLegType.EXTERNAL && l.status === PaymentLegStatus.CONFIRMED);
      if (!confirmedExternal) throw new BadRequestException('There is no confirmed external payment to dispute');
    }

    const remaining = order.totalAmount.minus(order.refundedAmount);
    const disputed = params.disputedAmount ? parsePositiveMoney(params.disputedAmount, 'disputedAmount') : remaining;
    if (disputed.greaterThan(remaining)) throw new BadRequestException('The disputed amount exceeds what is left on the order');

    try {
      const dispute = await this.prisma.$transaction(async (tx) => {
        const settled = order.operationalStatus === Op.COMPLETED && (await this.isSettled(tx, order.id, order.completionLedgerTransactionId));
        const created = await tx.orderDispute.create({
          data: {
            orderId: order.id,
            type: params.type,
            reason: params.reason,
            description: params.description,
            openedByUserId: params.actorId,
            openedByType: params.actorType,
            disputedAmount: disputed,
            openedAfterSettlement: settled,
          },
        });
        const flagged = await tx.partnerOrder.updateMany({
          where: { id: order.id, disputeStatus: { not: PartnerOrderDisputeStatus.OPEN } },
          data: { disputeStatus: PartnerOrderDisputeStatus.OPEN },
        });
        if (flagged.count === 0) throw new ConflictException('A dispute is already open on this order');

        if (params.type === OrderDisputeType.ORDER && order.operationalStatus === Op.COMPLETED && !settled) {
          const electronic = order.paymentLegs
            .filter((l) => l.type !== PaymentLegType.EXTERNAL && l.status === PaymentLegStatus.SETTLED)
            .reduce((s, l) => s.plus(l.amount.minus(l.refundedAmount)), ZERO);
          const netCredit = Decimal.max(electronic.minus(order.poolAmount ?? ZERO), ZERO);
          const frozen = roundIssued(netCredit.times(disputed).dividedBy(order.totalAmount));
          if (frozen.greaterThan(0)) {
            const holdId = await this.commerceLedger.holdForDispute(order.partnerId, frozen, { sourceType: 'OrderDispute', sourceId: created.id }, tx);
            await tx.orderDispute.update({ where: { id: created.id }, data: { frozenAmount: frozen, holdLedgerTransactionId: holdId } });
          }
        }
        await this.auditService.record(
          {
            actorUserId: params.actorId,
            action: AuditAction.ORDER_DISPUTE_OPENED,
            entityType: 'OrderDispute',
            entityId: created.id,
            metadata: { orderId: order.id, type: params.type, disputedAmount: disputed.toString(), openedAfterSettlement: settled, actorType: params.actorType },
          },
          tx,
        );
        return tx.orderDispute.findUniqueOrThrow({ where: { id: created.id } });
      });
      await this.notifier.disputeCreated(order);
      return dispute;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A dispute is already open on this order');
      }
      throw err;
    }
  }

  async comment(disputeId: string, params: { authorId: string; authorType: PartnerOrderActorType; body: string; attachmentUrls?: string[] }) {
    const dispute = await this.prisma.orderDispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const comment = await this.prisma.orderDisputeComment.create({
      data: {
        disputeId,
        authorUserId: params.authorId,
        authorType: params.authorType,
        body: params.body,
        attachmentUrls: params.attachmentUrls ?? [],
      },
    });
    await this.auditService.record({
      actorUserId: params.authorId,
      action: AuditAction.ORDER_DISPUTE_COMMENTED,
      entityType: 'OrderDispute',
      entityId: disputeId,
      metadata: { commentId: comment.id, authorType: params.authorType },
    });
    return comment;
  }

  /**
   * Admin decision. The claim on OPEN makes it idempotent and safe against a
   * second admin: the loser gets a conflict, nothing runs twice. The hold is
   * always released first; a customer refund then runs through the one
   * return path (`PartnerOrderReturnsService`) — on a completed order a
   * proportional return, before completion a full cancellation.
   */
  async resolve(disputeId: string, adminUserId: string, params: ResolveDisputeParams) {
    const dispute = await this.prisma.orderDispute.findUnique({ where: { id: disputeId }, include: { order: true } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const refund =
      params.outcome === 'RESOLVED_PARTNER' || !params.customerRefundAmount
        ? ZERO
        : parsePositiveMoney(params.customerRefundAmount, 'customerRefundAmount');
    if (params.outcome !== 'RESOLVED_PARTNER' && dispute.type === OrderDisputeType.ORDER && refund.isZero()) {
      throw new BadRequestException('A customer-favourable order dispute needs the amount returned to the customer');
    }
    if (refund.greaterThan(dispute.disputedAmount)) throw new BadRequestException('The refund exceeds the disputed amount');
    const orderOp = dispute.order.operationalStatus;
    if (refund.greaterThan(0) && orderOp !== Op.COMPLETED && !refund.equals(dispute.order.totalAmount)) {
      throw new BadRequestException('Before completion only a full refund (cancellation) can be decided');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.orderDispute.updateMany({
        where: { id: disputeId, status: OrderDisputeStatus.OPEN },
        data: {
          status: params.outcome as OrderDisputeStatus,
          resolvedByUserId: adminUserId,
          resolvedAt: new Date(),
          resolutionNote: params.note,
          customerRefundAmount: refund.greaterThan(0) ? refund : null,
        },
      });
      if (claimed.count === 0) throw new ConflictException('This dispute has already been resolved');
      if (dispute.frozenAmount.greaterThan(0)) {
        const releaseId = await this.commerceLedger.releaseDisputeHold(
          dispute.order.partnerId,
          dispute.frozenAmount,
          { sourceType: 'OrderDispute', sourceId: disputeId },
          tx,
        );
        await tx.orderDispute.update({ where: { id: disputeId }, data: { releaseLedgerTransactionId: releaseId } });
      }
      await tx.partnerOrder.update({
        where: { id: dispute.orderId },
        data: { disputeStatus: params.outcome as PartnerOrderDisputeStatus },
      });
      if (refund.greaterThan(0) && orderOp !== Op.COMPLETED) {
        await this.orders.cancelInTx(
          tx,
          dispute.orderId,
          { type: PartnerOrderActorType.ADMIN, userId: adminUserId },
          `dispute_resolved_for_customer: ${params.note}`,
          [...RECEIPT_ALLOWED_FROM, Op.RECEIVED],
        );
      }
      await this.auditService.record(
        {
          actorUserId: adminUserId,
          action: AuditAction.ORDER_DISPUTE_RESOLVED,
          entityType: 'OrderDispute',
          entityId: disputeId,
          metadata: {
            orderId: dispute.orderId,
            outcome: params.outcome,
            customerRefundAmount: refund.toString(),
            frozenReleased: dispute.frozenAmount.toString(),
            openedAfterSettlement: dispute.openedAfterSettlement,
            note: params.note,
          },
        },
        tx,
      );
    });

    if (refund.greaterThan(0) && orderOp === Op.COMPLETED) {
      await this.returns.createReturn({
        orderId: dispute.orderId,
        amount: refund.toFixed(4),
        reason: `dispute ${disputeId}: ${params.note}`,
        actorId: adminUserId,
        actorType: PartnerOrderActorType.ADMIN,
        idempotencyKey: `dispute-${disputeId}`,
        disputeId,
      });
    }
    if (params.outcome === 'RESOLVED_PARTNER' && orderOp === Op.RECEIVED) {
      // The dispute was what held the completion back.
      const split = null;
      await this.prisma.$transaction((tx) => this.orders.tryComplete(tx, dispute.orderId, split));
    }
    const order = await this.orders.findByIdOrThrow(dispute.orderId);
    await this.notifier.disputeResolved(order);
    return this.prisma.orderDispute.findUniqueOrThrow({ where: { id: disputeId }, include: { comments: true, returns: true } });
  }

  listOpen() {
    return this.prisma.orderDispute.findMany({
      where: { status: OrderDisputeStatus.OPEN },
      include: {
        comments: { orderBy: { createdAt: 'asc' } },
        order: {
          include: {
            items: true,
            paymentLegs: true,
            partner: { select: { id: true, displayName: true } },
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  listForOrder(orderId: string) {
    return this.prisma.orderDispute.findMany({
      where: { orderId },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
