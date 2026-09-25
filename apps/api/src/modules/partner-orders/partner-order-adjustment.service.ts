import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  PartnerOrderAdjustmentStatus,
  PartnerOrderAdjustmentType,
  PartnerOrderPaymentStatus,
  PartnerOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerBalanceService } from '../customer-balance/customer-balance.service';
import { PartnerOrdersService } from './partner-orders.service';

/**
 * Spec §15's customer-facing half: an `ALTERNATE_PRODUCT` or `PRICE_INCREASE`
 * adjustment sits `PENDING_CUSTOMER` until the customer explicitly accepts
 * or declines it here. `PRICE_DECREASE` never reaches this service — it
 * auto-applies inside `SourcingTaskService.recordResult`, since spec §15
 * only requires customer sign-off for paying *more* or getting something
 * *different*, never for the same item at a lower price.
 */
@Injectable()
export class PartnerOrderAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly customerBalance: CustomerBalanceService,
    private readonly partnerOrders: PartnerOrdersService,
  ) {}

  async findByIdOrThrow(id: string) {
    const adjustment = await this.prisma.partnerOrderAdjustment.findUnique({ where: { id } });
    if (!adjustment) throw new NotFoundException('Adjustment not found');
    return adjustment;
  }

  async respond(adjustmentId: string, customerId: string, accept: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.partnerOrderAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!adjustment) throw new NotFoundException('Adjustment not found');
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: adjustment.orderId } });
      if (order.customerId !== customerId) {
        throw new ForbiddenException('This order belongs to a different customer');
      }
      if (adjustment.status !== PartnerOrderAdjustmentStatus.PENDING_CUSTOMER) {
        return adjustment; // already resolved — idempotent
      }

      if (!accept) {
        await tx.partnerOrderAdjustment.update({
          where: { id: adjustmentId },
          data: { status: PartnerOrderAdjustmentStatus.CUSTOMER_DECLINED, customerRespondedAt: new Date() },
        });
        // Reuses the sourcing-failed refund reason: from the money's point
        // of view a declined substitute/price-increase and an unfindable
        // item are the same outcome — the order could not be fulfilled as
        // paid for, so the full captured amount goes back.
        await this.partnerOrders.refundInternal(
          tx,
          order,
          PartnerOrderAdjustmentType.SOURCING_FAILED_REFUND,
          'customer_declined_adjustment',
        );
        await this.auditService.record({
          actorUserId: customerId,
          action: AuditAction.PARTNER_ORDER_ADJUSTMENT_CUSTOMER_RESPONDED,
          entityType: 'PartnerOrderAdjustment',
          entityId: adjustmentId,
          metadata: { accepted: false },
        });
        return tx.partnerOrderAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
      }

      await tx.partnerOrderAdjustment.update({
        where: { id: adjustmentId },
        data: { status: PartnerOrderAdjustmentStatus.CUSTOMER_ACCEPTED, customerRespondedAt: new Date() },
      });
      await this.auditService.record({
        actorUserId: customerId,
        action: AuditAction.PARTNER_ORDER_ADJUSTMENT_CUSTOMER_RESPONDED,
        entityType: 'PartnerOrderAdjustment',
        entityId: adjustmentId,
        metadata: { accepted: true, deltaAmount: adjustment.deltaAmount.toString() },
      });

      if (adjustment.deltaAmount.greaterThan(0)) {
        // Needs the additional checkout (spec §15) — nothing more happens
        // here until `payAdditionalAmount` captures the difference.
        await tx.partnerOrderAdjustment.update({
          where: { id: adjustmentId },
          data: { additionalPaymentStatus: PartnerOrderPaymentStatus.PAYMENT_PENDING },
        });
        return tx.partnerOrderAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
      }

      // deltaAmount <= 0: an alternate found at the same price or cheaper —
      // resolve immediately, same as an accepted decrease would.
      await this.partnerOrders.resolveWithNewPrice(
        tx,
        order,
        adjustment.newTotalAmount,
        customerId,
        [PartnerOrderStatus.CUSTOMER_DECISION_REQUIRED],
      );
      await tx.partnerOrderAdjustment.update({
        where: { id: adjustmentId },
        data: { status: PartnerOrderAdjustmentStatus.APPLIED, appliedAt: new Date() },
      });
      return tx.partnerOrderAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
    });
  }

  /** Spec §15's "дополнительный checkout на 3 000 AMD" for an accepted price increase. */
  async payAdditionalAmount(adjustmentId: string, customerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.partnerOrderAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!adjustment) throw new NotFoundException('Adjustment not found');
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: adjustment.orderId } });
      if (order.customerId !== customerId) {
        throw new ForbiddenException('This order belongs to a different customer');
      }
      if (adjustment.additionalPaymentStatus !== PartnerOrderPaymentStatus.PAYMENT_PENDING) {
        return { adjustment, insufficientBalance: false };
      }
      if (adjustment.status !== PartnerOrderAdjustmentStatus.CUSTOMER_ACCEPTED) {
        throw new BadRequestException('This adjustment has not been accepted yet');
      }

      const capture = await this.customerBalance.debitForPartnerOrder(
        customerId,
        adjustment.deltaAmount,
        order.currency,
        order.partnerId,
        { type: 'PartnerOrderAdjustment', id: adjustment.id },
        tx,
      );
      if (!capture.collected) {
        return { adjustment, insufficientBalance: true };
      }

      await tx.partnerOrderAdjustment.update({
        where: { id: adjustmentId },
        data: {
          additionalPaymentStatus: PartnerOrderPaymentStatus.PAID,
          ledgerTransactionId: capture.ledgerTransactionId,
        },
      });

      await this.auditService.record({
        actorUserId: customerId,
        action: AuditAction.PARTNER_ORDER_ADDITIONAL_PAYMENT_PAID,
        entityType: 'PartnerOrderAdjustment',
        entityId: adjustmentId,
        metadata: { amount: adjustment.deltaAmount.toString() },
      });

      await this.partnerOrders.resolveWithNewPrice(
        tx,
        order,
        adjustment.newTotalAmount,
        customerId,
        [PartnerOrderStatus.CUSTOMER_DECISION_REQUIRED],
      );
      const applied = await tx.partnerOrderAdjustment.update({
        where: { id: adjustmentId },
        data: { status: PartnerOrderAdjustmentStatus.APPLIED, appliedAt: new Date() },
      });

      return { adjustment: applied, insufficientBalance: false };
    });
  }
}
