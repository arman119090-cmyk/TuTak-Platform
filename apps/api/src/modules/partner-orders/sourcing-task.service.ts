import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  PartnerOrderActorType,
  PartnerOrderAdjustmentStatus,
  PartnerOrderAdjustmentType,
  PartnerOrderOperationalStatus as Op,
  PartnerOrderSourcingStatus as Sourcing,
  Prisma,
  SourcingTaskStatus,
} from '@prisma/client';
import { parsePositiveMoney, roundCharge } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';
import { PartnerOrdersService } from './partner-orders.service';
import { RecordSourcingResultDto } from './dto/record-sourcing-result.dto';

/**
 * TuTak staff's internal "find this item elsewhere" queue (spec §35-42) —
 * manual: first TuTak's own partners, then external sources such as
 * List.am; no scraper. Nothing found is ever applied silently: every found
 * result — even the identical item at the identical price — becomes a
 * proposal the customer must accept (spec §39-40). Nothing found cancels
 * the order with every leg back to its source (spec §42): no reserve is left
 * hanging.
 */
@Injectable()
export class SourcingTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly partnerOrders: PartnerOrdersService,
    private readonly notifier: PartnerOrderNotifier,
  ) {}

  /** Spec §37: everything the searcher needs, including what is already secured. */
  listOpen() {
    return this.prisma.sourcingTask.findMany({
      where: { status: { in: [SourcingTaskStatus.OPEN, SourcingTaskStatus.SEARCHING] } },
      include: {
        order: {
          include: {
            items: true,
            paymentLegs: true,
            partner: { select: { id: true, displayName: true } },
            customer: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * "Взял в работу". Claims the task *and* the order's sourcing state in one
   * transaction, conditional on the order still waiting for sourcing — so if
   * the partner found the item after all ("В наличии" from OUT_OF_STOCK),
   * exactly one of the two wins (spec §61 "sourcing assignment ×
   * stockConfirmed").
   */
  async claim(taskId: string, employeeUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.sourcingTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Sourcing task not found');
      if (task.status === SourcingTaskStatus.SEARCHING) {
        if (task.assignedToUserId !== employeeUserId) throw new ForbiddenException('Already claimed by someone else');
        return;
      }
      const claimedTask = await tx.sourcingTask.updateMany({
        where: { id: taskId, status: SourcingTaskStatus.OPEN },
        data: { status: SourcingTaskStatus.SEARCHING, assignedToUserId: employeeUserId, claimedAt: new Date() },
      });
      if (claimedTask.count === 0) throw new ConflictException('This sourcing task is no longer open');
      const claimedOrder = await tx.partnerOrder.updateMany({
        where: { id: task.orderId, operationalStatus: Op.OUT_OF_STOCK, sourcingStatus: Sourcing.REQUIRED },
        data: { sourcingStatus: Sourcing.SEARCHING },
      });
      if (claimedOrder.count === 0) throw new ConflictException('This order no longer needs sourcing');
      await this.auditService.record(
        {
          actorUserId: employeeUserId,
          action: AuditAction.PARTNER_ORDER_SOURCING_TASK_CLAIMED,
          entityType: 'SourcingTask',
          entityId: taskId,
          metadata: { orderId: task.orderId },
        },
        tx,
      );
    });
    return this.prisma.sourcingTask.findUniqueOrThrow({ where: { id: taskId } });
  }

  /** Spec §37's three buttons: «Найден точный товар», «Найден аналог», «Не найден». */
  async recordResult(taskId: string, dto: RecordSourcingResultDto, employeeUserId: string) {
    let outcome = 'noop' as 'cancelled' | 'proposed' | 'noop';
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.sourcingTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Sourcing task not found');
      if (task.status !== SourcingTaskStatus.OPEN && task.status !== SourcingTaskStatus.SEARCHING) return; // resolved — idempotent
      const order = await tx.partnerOrder.findUniqueOrThrow({ where: { id: task.orderId } });
      const now = new Date();

      if (dto.status === 'NOT_FOUND') {
        const claimed = await tx.sourcingTask.updateMany({
          where: { id: taskId, status: { in: [SourcingTaskStatus.OPEN, SourcingTaskStatus.SEARCHING] } },
          data: { status: SourcingTaskStatus.NOT_FOUND, resolvedAt: now, resultNotes: dto.notes },
        });
        if (claimed.count === 0) return;
        await tx.partnerOrderAdjustment.create({
          data: {
            orderId: order.id,
            type: PartnerOrderAdjustmentType.SOURCING_FAILED_REFUND,
            status: PartnerOrderAdjustmentStatus.APPLIED,
            previousTotalAmount: order.totalAmount,
            newTotalAmount: order.totalAmount,
            deltaAmount: new Prisma.Decimal(0),
            reason: dto.notes,
            appliedAt: now,
          },
        });
        await this.partnerOrders.cancelInTx(
          tx,
          order.id,
          { type: PartnerOrderActorType.SYSTEM, userId: employeeUserId },
          'sourcing_not_found',
          [Op.OUT_OF_STOCK],
        );
        await this.recordAudit(tx, employeeUserId, taskId, { status: 'NOT_FOUND' });
        outcome = 'cancelled';
        return;
      }

      if (!dto.productName || !dto.price) {
        throw new BadRequestException('productName and price are required for a found result');
      }
      const price = roundCharge(parsePositiveMoney(dto.price, 'price'));
      const delta = price.minus(order.totalAmount);
      const type =
        dto.status === 'FOUND_ALTERNATE'
          ? PartnerOrderAdjustmentType.ALTERNATE_PRODUCT
          : delta.isZero()
            ? PartnerOrderAdjustmentType.SAME_ITEM_OTHER_SOURCE
            : delta.isNegative()
              ? PartnerOrderAdjustmentType.PRICE_DECREASE
              : PartnerOrderAdjustmentType.PRICE_INCREASE;

      const claimedOrder = await tx.partnerOrder.updateMany({
        where: {
          id: order.id,
          operationalStatus: Op.OUT_OF_STOCK,
          sourcingStatus: { in: [Sourcing.REQUIRED, Sourcing.SEARCHING] },
        },
        data: { sourcingStatus: Sourcing.AWAITING_CUSTOMER },
      });
      if (claimedOrder.count === 0) throw new ConflictException('This order no longer needs sourcing');

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
          resolvedAt: now,
        },
      });
      await tx.partnerOrderAdjustment.create({
        data: {
          orderId: order.id,
          type,
          status: PartnerOrderAdjustmentStatus.PENDING_CUSTOMER,
          previousTotalAmount: order.totalAmount,
          newTotalAmount: price,
          deltaAmount: delta,
          description: dto.productName,
          imageUrl: dto.imageUrl,
          details: {
            description: dto.description ?? null,
            differences: dto.differences ?? null,
            sourceType: dto.sourceType ?? null,
          },
          reason: dto.notes,
        },
      });
      await this.recordAudit(tx, employeeUserId, taskId, { status: dto.status, price: price.toString(), type });
      outcome = 'proposed';
    });

    const task = await this.prisma.sourcingTask.findUniqueOrThrow({ where: { id: taskId }, include: { order: true } });
    if (outcome === 'cancelled') await this.notifier.cancelled(task.order);
    if (outcome === 'proposed') await this.notifier.decisionRequired(task.order);
    return task;
  }

  private recordAudit(tx: Prisma.TransactionClient, actorUserId: string, taskId: string, metadata: Record<string, unknown>) {
    return this.auditService.record(
      {
        actorUserId,
        action: AuditAction.PARTNER_ORDER_SOURCING_RESULT_RECORDED,
        entityType: 'SourcingTask',
        entityId: taskId,
        metadata,
      },
      tx,
    );
  }
}
