import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  PartnerOrderAdjustmentStatus,
  PartnerOrderAdjustmentType,
  PartnerOrderStatus,
  SourcingTaskStatus,
} from '@prisma/client';
import { parsePositiveMoney, roundCharge } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PartnerOrdersService } from './partner-orders.service';
import { RecordSourcingResultDto } from './dto/record-sourcing-result.dto';

/**
 * TuTak staff's internal "find this item elsewhere" queue — spec §13. Mirrors
 * `FraudDetectionService`'s open/resolved queue shape, plus a claim step
 * (spec §9's "взял в работу", generalised here to sourcing too — an
 * unclaimed search is exactly as much "somebody's problem, nobody's task" as
 * an unclaimed escalation).
 */
@Injectable()
export class SourcingTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly partnerOrders: PartnerOrdersService,
  ) {}

  listOpen() {
    return this.prisma.sourcingTask.findMany({
      where: { status: { in: [SourcingTaskStatus.OPEN, SourcingTaskStatus.SEARCHING] } },
      include: { order: { include: { items: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByOrderIdOrThrow(orderId: string) {
    const task = await this.prisma.sourcingTask.findUnique({ where: { orderId } });
    if (!task) throw new NotFoundException('No sourcing task for this order');
    return task;
  }

  /** "Взял в работу" — does not remove it from `listOpen()`, just attributes it. */
  async claim(taskId: string, employeeUserId: string) {
    const claimed = await this.prisma.sourcingTask.updateMany({
      where: { id: taskId, status: SourcingTaskStatus.OPEN },
      data: { status: SourcingTaskStatus.SEARCHING, assignedToUserId: employeeUserId, claimedAt: new Date() },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.sourcingTask.findUnique({ where: { id: taskId } });
      if (!existing) throw new NotFoundException('Sourcing task not found');
      // Idempotent for the same claimant re-claiming; otherwise it is a real conflict.
      if (existing.assignedToUserId && existing.assignedToUserId !== employeeUserId) {
        throw new ForbiddenException('Already claimed by someone else');
      }
    }
    return this.prisma.sourcingTask.findUniqueOrThrow({ where: { id: taskId } });
  }

  /**
   * Spec §13's three buttons. NOT_FOUND refunds outright (spec §16).
   * FOUND_EXACT at the same price resolves the order straight back into
   * fulfilment (spec §15's "continue as before" case — no customer decision
   * needed for an identical item at an identical price). Every other case —
   * FOUND_EXACT at a different price, or FOUND_ALTERNATE at any price —
   * creates a `PartnerOrderAdjustment` and moves the order to
   * `CUSTOMER_DECISION_REQUIRED`; nothing about it applies until the
   * customer explicitly responds (`PartnerOrderAdjustmentService.respond`).
   */
  async recordResult(taskId: string, dto: RecordSourcingResultDto, employeeUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.sourcingTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Sourcing task not found');
      if (task.status === SourcingTaskStatus.RESOLVED || task.status === SourcingTaskStatus.NOT_FOUND) {
        return task; // already resolved — idempotent
      }
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: task.orderId } });

      if (dto.status === 'NOT_FOUND') {
        await tx.sourcingTask.update({
          where: { id: taskId },
          data: { status: SourcingTaskStatus.NOT_FOUND, resolvedAt: new Date(), resultNotes: dto.notes },
        });
        await this.partnerOrders.refundInternal(
          tx,
          order,
          PartnerOrderAdjustmentType.SOURCING_FAILED_REFUND,
          'sourcing_not_found',
        );
        await this.auditService.record({
          actorUserId: employeeUserId,
          action: AuditAction.PARTNER_ORDER_SOURCING_RESULT_RECORDED,
          entityType: 'SourcingTask',
          entityId: taskId,
          metadata: { status: 'NOT_FOUND' },
        });
        return tx.sourcingTask.findUniqueOrThrow({ where: { id: taskId } });
      }

      if (!dto.productName || !dto.price) {
        throw new BadRequestException('productName and price are required for a found result');
      }
      const price = parsePositiveMoney(dto.price, 'price');

      await tx.sourcingTask.update({
        where: { id: taskId },
        data: {
          status: dto.status === 'FOUND_EXACT' ? SourcingTaskStatus.FOUND_EXACT : SourcingTaskStatus.FOUND_ALTERNATE,
          resultSourceType: dto.sourceType,
          resultSourcePartnerId: dto.sourcePartnerId,
          resultProductName: dto.productName,
          resultDescription: dto.description,
          resultImageUrl: dto.imageUrl,
          resultPrice: price,
          resultNotes: dto.notes,
          resolvedAt: new Date(),
        },
      });

      await this.auditService.record({
        actorUserId: employeeUserId,
        action: AuditAction.PARTNER_ORDER_SOURCING_RESULT_RECORDED,
        entityType: 'SourcingTask',
        entityId: taskId,
        metadata: { status: dto.status, price: price.toString() },
      });

      const samePrice = price.equals(order.totalAmount);
      if (dto.status === 'FOUND_EXACT' && samePrice) {
        // No customer decision needed — resume fulfilment exactly like a
        // normal stock confirmation would have.
        await tx.sourcingTask.update({ where: { id: taskId }, data: { status: SourcingTaskStatus.RESOLVED } });
        return this.partnerOrders.confirmSourcedStock(tx, order, employeeUserId);
      }

      if (dto.status === 'FOUND_EXACT' && price.lessThan(order.totalAmount)) {
        // Spec §15: a cheaper exact match refunds the difference and
        // continues automatically — unlike a price *increase* or an
        // alternate product, nothing here asks the customer to agree to pay
        // less for the same thing.
        await tx.sourcingTask.update({ where: { id: taskId }, data: { status: SourcingTaskStatus.RESOLVED } });
        await tx.partnerOrderAdjustment.create({
          data: {
            orderId: order.id,
            type: PartnerOrderAdjustmentType.PRICE_DECREASE,
            status: PartnerOrderAdjustmentStatus.APPLIED,
            previousTotalAmount: order.totalAmount,
            newTotalAmount: roundCharge(price),
            deltaAmount: roundCharge(price).minus(order.totalAmount),
            description: dto.productName,
            reason: dto.notes,
            appliedAt: new Date(),
          },
        });
        return this.partnerOrders.resolveWithNewPrice(
          tx,
          order,
          roundCharge(price),
          employeeUserId,
          [PartnerOrderStatus.SOURCING_REQUIRED, PartnerOrderStatus.SOURCING_IN_PROGRESS],
        );
      }

      // Everything else — a price increase, or any alternate product —
      // needs the customer's explicit yes first (spec §15).
      const adjustmentType =
        dto.status === 'FOUND_ALTERNATE'
          ? PartnerOrderAdjustmentType.ALTERNATE_PRODUCT
          : PartnerOrderAdjustmentType.PRICE_INCREASE;

      await tx.partnerOrderAdjustment.create({
        data: {
          orderId: order.id,
          type: adjustmentType,
          status: PartnerOrderAdjustmentStatus.PENDING_CUSTOMER,
          previousTotalAmount: order.totalAmount,
          newTotalAmount: roundCharge(price),
          deltaAmount: roundCharge(price).minus(order.totalAmount),
          description: dto.productName,
          reason: dto.notes,
        },
      });

      await tx.partnerOrder.update({
        where: { id: order.id },
        data: { orderStatus: PartnerOrderStatus.CUSTOMER_DECISION_REQUIRED },
      });

      return tx.sourcingTask.findUniqueOrThrow({ where: { id: taskId } });
    });
  }
}
