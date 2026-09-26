import { Injectable } from '@nestjs/common';
import { AuditAction, OrderEscalationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { AlertSeverity } from '../../infrastructure/alerts/alert-channel.interface';
import { AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;

const SEVERITY: Record<OrderEscalationType, AlertSeverity> = {
  NOT_SEEN_5MIN: 'warning',
  STOCK_NOT_CONFIRMED_30MIN: 'critical',
  STOCK_NOT_CONFIRMED_REPEAT: 'critical',
  RECEIPT_NOT_CONFIRMED_48H: 'warning',
  PAYMENT_ISSUE: 'warning',
};

const TITLE: Record<OrderEscalationType, string> = {
  NOT_SEEN_5MIN: 'Partner has not seen an order',
  STOCK_NOT_CONFIRMED_30MIN: 'Stock not confirmed for 30 minutes',
  STOCK_NOT_CONFIRMED_REPEAT: 'Stock still not confirmed',
  RECEIPT_NOT_CONFIRMED_48H: 'Customer has not confirmed receipt for 48 hours — manual review',
  PAYMENT_ISSUE: 'Order received but external payment unconfirmed',
};

/**
 * TuTak's own internal "needs attention" trail for Partner Commerce (spec
 * §17-18, §55, Q7d) — never customer-visible (§19). Each escalation is a
 * queue row *and* an operator alert through the existing
 * `AlertsService.fire` (webhook channel, Redis-backed suppression): no
 * second operator-notification system.
 *
 * "Взял в работу" (claim) stops further pushes for that order's problem —
 * the repeat alert is not fired while a claimed one is open — but the order
 * stays in the queue until the problem itself is resolved.
 */
@Injectable()
export class OrderEscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly auditService: AuditService,
  ) {}

  /** The admin queue: everything an operator needs to phone the partner (spec §17). */
  listOpen(type?: OrderEscalationType) {
    return this.prisma.orderEscalation.findMany({
      where: { resolvedAt: null, ...(type ? { type } : {}) },
      include: {
        order: {
          include: {
            partner: { select: { id: true, displayName: true, legalName: true } },
            branch: { select: { id: true, name: true, address: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async hasClaimedOpenEscalation(orderId: string, types: OrderEscalationType[]): Promise<boolean> {
    const existing = await this.prisma.orderEscalation.findFirst({
      where: { orderId, type: { in: types }, resolvedAt: null, claimedByUserId: { not: null } },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * Records the escalation and fires the operator alert. `alertKey` must be
   * unique per *tick* for a repeating alert (the suppression window would
   * otherwise swallow the 35/40/45-minute repeats).
   */
  async raise(
    order: { id: string; orderNumber: number; partnerId: string; totalAmount: Prisma.Decimal; submittedAt: Date | null },
    type: OrderEscalationType,
    alertKey: string,
    context: Record<string, string | number> = {},
  ) {
    const escalation = await this.prisma.orderEscalation.create({
      data: { orderId: order.id, type, metadata: context as Prisma.InputJsonValue },
    });
    await this.auditService.record({
      action: AuditAction.PARTNER_ORDER_ESCALATION_RAISED,
      entityType: 'OrderEscalation',
      entityId: escalation.id,
      metadata: { orderId: order.id, type },
    });
    const partner = await this.prisma.partner.findUnique({
      where: { id: order.partnerId },
      select: { displayName: true },
    });
    const elapsedMinutes = order.submittedAt ? Math.floor((Date.now() - order.submittedAt.getTime()) / 60_000) : 0;
    await this.alerts.fire({
      severity: SEVERITY[type],
      title: `${TITLE[type]} — #${order.orderNumber}`,
      body:
        `Order #${order.orderNumber} at ${partner?.displayName ?? order.partnerId}, ` +
        `${order.totalAmount.toFixed(0)} AMD, ${elapsedMinutes} min since it was submitted. ` +
        'Open the Partner Commerce queue in the admin panel to call the partner.',
      key: alertKey,
      context: { orderId: order.id, orderNumber: order.orderNumber, partnerId: order.partnerId, elapsedMinutes, ...context },
    });
    return escalation;
  }

  /** "Взял в работу". Idempotent for the same operator. */
  async claim(id: string, employeeUserId: string) {
    const claimed = await this.prisma.orderEscalation.updateMany({
      where: { id, resolvedAt: null, claimedByUserId: null },
      data: { claimedByUserId: employeeUserId, claimedAt: new Date() },
    });
    if (claimed.count > 0) {
      await this.auditService.record({
        actorUserId: employeeUserId,
        action: AuditAction.PARTNER_ORDER_ESCALATION_CLAIMED,
        entityType: 'OrderEscalation',
        entityId: id,
      });
    }
    return this.prisma.orderEscalation.findUniqueOrThrow({ where: { id } });
  }

  async resolve(id: string, actorUserId: string) {
    const resolved = await this.prisma.orderEscalation.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByUserId: actorUserId },
    });
    if (resolved.count > 0) {
      await this.auditService.record({
        actorUserId,
        action: AuditAction.PARTNER_ORDER_ESCALATION_RESOLVED,
        entityType: 'OrderEscalation',
        entityId: id,
      });
    }
    return this.prisma.orderEscalation.findUniqueOrThrow({ where: { id } });
  }

  /** Auto-resolves the named problem types once the order leaves that problem state. */
  async resolveTypes(orderId: string, types: OrderEscalationType[], actorUserId: string | null, tx?: Tx) {
    await (tx ?? this.prisma).orderEscalation.updateMany({
      where: { orderId, type: { in: types }, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByUserId: actorUserId },
    });
  }
}
