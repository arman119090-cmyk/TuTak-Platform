import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  PartnerOrderActorType,
  PartnerOrderAdjustmentStatus,
  PartnerOrderOperationalStatus as Op,
  PartnerOrderSourcingStatus as Sourcing,
  PaymentLegPurpose,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommissionDistributionService } from '../commission-distribution/commission-distribution.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';
import { PartnerOrderPaymentsService, PaymentSplit } from './partner-order-payments.service';
import { PartnerOrdersService } from './partner-orders.service';
import { AcceptAdjustmentDto } from './dto/accept-adjustment.dto';

const ZERO = new Decimal(0);

/**
 * The customer's answer to a sourcing proposal (spec §39-42). Nothing here
 * is ever applied without the customer's explicit "yes"; a "no" cancels the
 * order with every leg back to its source.
 *
 *  - more expensive: the customer funds the difference exactly like the
 *    original checkout (discount / TuTak money / external), captured in the
 *    same transaction as the acceptance;
 *  - cheaper: the difference comes off the legs (an unpaid external leg
 *    first, then TuTak money, then the discount);
 *  - same price: accepted as is.
 *
 * The commission base follows the purchase actually agreed (spec §41): the
 * order's `totalAmount` and pool are updated, and the distribution at
 * completion runs on the new total.
 */
@Injectable()
export class PartnerOrderAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly orders: PartnerOrdersService,
    private readonly payments: PartnerOrderPaymentsService,
    private readonly distribution: CommissionDistributionService,
    private readonly notifier: PartnerOrderNotifier,
  ) {}

  private async load(adjustmentId: string, customerId: string) {
    const adjustment = await this.prisma.partnerOrderAdjustment.findUnique({
      where: { id: adjustmentId },
      include: { order: true },
    });
    if (!adjustment || adjustment.order.customerId !== customerId) throw new NotFoundException('Proposal not found');
    return adjustment;
  }

  async accept(adjustmentId: string, customerId: string, dto: AcceptAdjustmentDto) {
    const adjustment = await this.load(adjustmentId, customerId);
    if (adjustment.status === PartnerOrderAdjustmentStatus.APPLIED) return this.orders.findByIdOrThrow(adjustment.orderId);
    if (adjustment.status !== PartnerOrderAdjustmentStatus.PENDING_CUSTOMER) {
      throw new ConflictException('This proposal is no longer open');
    }
    const order = adjustment.order;
    const delta = adjustment.deltaAmount;
    const increase: PaymentSplit | null = delta.greaterThan(0)
      ? await this.orders.validateSplit(order.partnerId, delta, dto.discountAmount, dto.tutakMoneyAmount)
      : null;

    let reservationId: string | null = null;
    try {
      if (increase) reservationId = await this.payments.reserveDiscount(customerId, increase.discount, order.sourceTransactionId!);
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimedAdjustment = await tx.partnerOrderAdjustment.updateMany({
          where: { id: adjustmentId, status: PartnerOrderAdjustmentStatus.PENDING_CUSTOMER },
          data: { status: PartnerOrderAdjustmentStatus.APPLIED, customerRespondedAt: now, appliedAt: now },
        });
        if (claimedAdjustment.count === 0) throw new ConflictException('This proposal was already answered');

        const newTotal = adjustment.newTotalAmount;
        let change: PaymentSplit = { discount: ZERO, tutakMoney: ZERO, external: ZERO };
        if (increase) {
          change = increase;
        } else if (delta.isNegative()) {
          const reduced = await this.payments.reduceLegs(
            tx,
            { id: order.id, partnerId: order.partnerId, customerId },
            delta.negated(),
            { sourceType: 'PartnerOrderAdjustment', sourceId: adjustmentId },
            'partner_order_price_decrease',
          );
          change = { discount: reduced.discount.negated(), tutakMoney: reduced.tutakMoney.negated(), external: reduced.external.negated() };
        }

        const claimedOrder = await tx.partnerOrder.updateMany({
          where: { id: order.id, customerId, operationalStatus: Op.OUT_OF_STOCK, sourcingStatus: Sourcing.AWAITING_CUSTOMER },
          data: {
            operationalStatus: Op.STOCK_CONFIRMED,
            sourcingStatus: Sourcing.RESOLVED,
            stockConfirmedAt: now,
            subtotal: newTotal,
            totalAmount: newTotal,
            commissionAmount: this.distribution.poolFor(newTotal, order.commissionRateBps),
            discountAmount: order.discountAmount.plus(change.discount),
            tutakMoneyAmount: order.tutakMoneyAmount.plus(change.tutakMoney),
            externalAmount: order.externalAmount.plus(change.external),
          },
        });
        if (claimedOrder.count === 0) throw new ConflictException('This order is no longer waiting for your decision');

        if (increase) {
          await this.payments.captureLegs(tx, order, customerId, increase, {
            purpose: PaymentLegPurpose.ADDITIONAL,
            adjustmentId,
            discountReservationId: reservationId,
            source: { sourceType: 'PartnerOrderAdjustment', sourceId: adjustmentId },
          });
        }
        if (order.sourceTransactionId) {
          await tx.transaction.update({
            where: { id: order.sourceTransactionId },
            data: { amount: newTotal, bonusAppliedAmount: order.discountAmount.plus(change.discount) },
          });
        }
        await this.orders.refreshFunding(tx, order.id);
        await this.auditService.record(
          {
            actorUserId: customerId,
            action: AuditAction.PARTNER_ORDER_ADJUSTMENT_CUSTOMER_RESPONDED,
            entityType: 'PartnerOrderAdjustment',
            entityId: adjustmentId,
            metadata: {
              accepted: true,
              orderId: order.id,
              previousTotal: adjustment.previousTotalAmount.toString(),
              newTotal: newTotal.toString(),
              discountChange: change.discount.toString(),
              tutakMoneyChange: change.tutakMoney.toString(),
              externalChange: change.external.toString(),
            },
          },
          tx,
        );
      });
    } catch (err) {
      await this.payments.compensateDiscount(reservationId, 'partner_order_adjustment_failed');
      if (err instanceof HttpException && (err.getResponse() as { error?: string })?.error === 'PRICE_DECREASE_NEEDS_EXTERNAL_REFUND') {
        // Nothing moved (the transaction rolled back). The cheaper price
        // could only be refunded out of cash the partner already holds —
        // a TuTak operator settles that by hand rather than a rule invented
        // here.
        await this.prisma.partnerOrder.update({
          where: { id: order.id },
          data: { manualReviewAt: new Date(), manualReviewReason: 'price_decrease_needs_external_refund' },
        });
      }
      throw err;
    }
    return this.orders.findByIdOrThrow(order.id);
  }

  async decline(adjustmentId: string, customerId: string) {
    const adjustment = await this.load(adjustmentId, customerId);
    if (adjustment.status === PartnerOrderAdjustmentStatus.CUSTOMER_DECLINED) return this.orders.findByIdOrThrow(adjustment.orderId);
    if (adjustment.status !== PartnerOrderAdjustmentStatus.PENDING_CUSTOMER) {
      throw new BadRequestException('This proposal is no longer open');
    }
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerOrderAdjustment.updateMany({
        where: { id: adjustmentId, status: PartnerOrderAdjustmentStatus.PENDING_CUSTOMER },
        data: { status: PartnerOrderAdjustmentStatus.CUSTOMER_DECLINED, customerRespondedAt: new Date() },
      });
      if (claimed.count === 0) return;
      await this.orders.cancelInTx(
        tx,
        adjustment.orderId,
        { type: PartnerOrderActorType.CUSTOMER, userId: customerId },
        'customer_declined_sourcing_proposal',
        [Op.OUT_OF_STOCK],
      );
      await this.auditService.record(
        {
          actorUserId: customerId,
          action: AuditAction.PARTNER_ORDER_ADJUSTMENT_CUSTOMER_RESPONDED,
          entityType: 'PartnerOrderAdjustment',
          entityId: adjustmentId,
          metadata: { accepted: false, orderId: adjustment.orderId },
        },
        tx,
      );
    });
    const order = await this.orders.findByIdOrThrow(adjustment.orderId);
    await this.notifier.cancelled(order);
    return order;
  }
}
