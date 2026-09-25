import { Injectable } from '@nestjs/common';
import { AuditAction, OrderEscalationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;

/**
 * TuTak's own internal "needs attention" trail — spec §8/§9/§21. Mirrors
 * `FraudDetectionService`'s open/resolved queue shape (`listOpen` =
 * `resolvedAt: null`) with one addition spec explicitly asks for that
 * `FraudSignal` has no precedent for: "взял в работу" (claim), which
 * silences further alerts for this specific problem without removing it
 * from the queue for anyone else still watching it.
 *
 * No push/device notification is sent from here — see
 * `PartnerOrderSlaSweepService`'s own docblock for why: this queue itself
 * *is* the alerting surface, the same way `GET /admin/fraud-signals` is the
 * whole of that system's alerting today, with no push counterpart either.
 */
@Injectable()
export class OrderEscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  listOpen(type?: OrderEscalationType) {
    return this.prisma.orderEscalation.findMany({
      where: { resolvedAt: null, ...(type ? { type } : {}) },
      include: { order: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Whether this order already has an open escalation, of one of these types, someone has taken into work. */
  async hasClaimedOpenEscalation(orderId: string, types: OrderEscalationType[]): Promise<boolean> {
    const existing = await this.prisma.orderEscalation.findFirst({
      where: { orderId, type: { in: types }, resolvedAt: null, claimedByUserId: { not: null } },
      select: { id: true },
    });
    return existing !== null;
  }

  async raise(orderId: string, type: OrderEscalationType, metadata?: Record<string, unknown>) {
    const escalation = await this.prisma.orderEscalation.create({
      data: { orderId, type, metadata: metadata as never },
    });
    await this.auditService.record({
      action: AuditAction.PARTNER_ORDER_ESCALATION_RAISED,
      entityType: 'OrderEscalation',
      entityId: escalation.id,
      metadata: { orderId, type },
    });
    return escalation;
  }

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

  /** Auto-resolves every open escalation for an order once it leaves every problem state — e.g. stock finally confirmed or the order refunded. */
  async resolveAllForOrder(orderId: string, tx?: Tx) {
    await (tx ?? this.prisma).orderEscalation.updateMany({
      where: { orderId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  /** Auto-resolves only the named types — e.g. "seen" clears NOT_SEEN_5MIN without touching a still-open stock-confirmation problem. */
  async resolveOpenByType(orderId: string, types: OrderEscalationType[], tx?: Tx) {
    await (tx ?? this.prisma).orderEscalation.updateMany({
      where: { orderId, type: { in: types }, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }
}
