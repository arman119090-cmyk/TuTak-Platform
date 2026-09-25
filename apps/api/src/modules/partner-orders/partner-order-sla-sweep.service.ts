import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderEscalationType, PartnerOrderStatus } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderEscalationService } from './order-escalation.service';

/**
 * Spec §8-9's two SLA timers, driven by `sweeps.jobs.ts` the same way every
 * other timed effect in this codebase is: a deadline column plus a
 * repeating sweep, not a per-event delayed job — see that file's own
 * docblock ("One schedule, not one per instance") for why. `PurchaseIntent`
 * expiry (`purchase-intent.expire`) is the closest existing precedent: a
 * fixed deadline stamped at creation, checked by a sweep that runs far more
 * often than the deadline itself, so the *sweep's* own cadence is not what
 * bounds SLA accuracy — the stamped deadline is.
 *
 * No push/device notification is sent from these sweeps — the escalation
 * queue itself (`GET /admin/partner-orders/escalations`) is the alerting
 * surface, mirroring `FraudDetectionService`'s own queue-only pattern
 * exactly. Wiring a push to every ADMIN/SUPER_ADMIN device was judged out
 * of scope for this pass — see the final report's open-questions section.
 */
@Injectable()
export class PartnerOrderSlaSweepService {
  private readonly logger = new Logger(PartnerOrderSlaSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalations: OrderEscalationService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Spec §8: 5 minutes since `createdAt`, still not seen. Fires once per order. */
  async sweepNotSeen(): Promise<number> {
    const minutes = this.config.get('partnerOrderPolicy.notSeenAlertMinutes', { infer: true });
    const cutoff = new Date(Date.now() - minutes * 60_000);

    const overdue = await this.prisma.partnerOrder.findMany({
      where: {
        orderStatus: PartnerOrderStatus.PAID,
        partnerSeenAt: null,
        notSeenAlertSentAt: null,
        createdAt: { lt: cutoff },
      },
      select: { id: true, createdAt: true, partnerId: true },
    });

    for (const order of overdue) {
      // Claim first: two overlapping sweep ticks (or a slow tick still
      // running when the next fires) must not raise this twice.
      const claimed = await this.prisma.partnerOrder.updateMany({
        where: { id: order.id, notSeenAlertSentAt: null },
        data: { notSeenAlertSentAt: new Date() },
      });
      if (claimed.count === 0) continue;

      await this.escalations.raise(order.id, OrderEscalationType.NOT_SEEN_5MIN, {
        partnerId: order.partnerId,
        elapsedMinutes: Math.floor((Date.now() - order.createdAt.getTime()) / 60_000),
      });
    }
    return overdue.length;
  }

  /**
   * Spec §9: 30 minutes since `createdAt` — deliberately never
   * `partnerSeenAt`, so tapping "Увидел заказ" at minute 29 buys no extra
   * time — then every 5 minutes after, until stock is confirmed or
   * rejected. Skips creating another escalation (and so another alert) for
   * an order whose current problem someone has already claimed — spec's own
   * "не нужно бесконечно отправлять одинаковый push конкретному сотруднику"
   * — while the order stays in the queue regardless, via `listOpen` /
   * `listForPartner` reading `PartnerOrder` state directly rather than only
   * through escalation rows.
   */
  async sweepStockNotConfirmed(): Promise<number> {
    const deadlineMinutes = this.config.get('partnerOrderPolicy.stockConfirmDeadlineMinutes', { infer: true });
    const repeatMinutes = this.config.get('partnerOrderPolicy.stockAlertRepeatMinutes', { infer: true });
    const deadlineCutoff = new Date(Date.now() - deadlineMinutes * 60_000);

    const overdue = await this.prisma.partnerOrder.findMany({
      where: {
        orderStatus: { in: [PartnerOrderStatus.PAID, PartnerOrderStatus.PARTNER_SEEN] },
        stockConfirmedAt: null,
        stockRejectedAt: null,
        createdAt: { lt: deadlineCutoff },
      },
      select: { id: true, createdAt: true, partnerId: true, stockAlertLastSentAt: true },
    });

    let alerted = 0;
    for (const order of overdue) {
      const isFirstAlert = order.stockAlertLastSentAt === null;
      const repeatDue =
        !isFirstAlert && order.stockAlertLastSentAt !== null &&
        Date.now() - order.stockAlertLastSentAt.getTime() >= repeatMinutes * 60_000;
      if (!isFirstAlert && !repeatDue) continue;

      const type = isFirstAlert
        ? OrderEscalationType.STOCK_NOT_CONFIRMED_30MIN
        : OrderEscalationType.STOCK_NOT_CONFIRMED_REPEAT;

      // Someone already has this in hand — stay in the queue, stop paging.
      if (
        await this.escalations.hasClaimedOpenEscalation(order.id, [
          OrderEscalationType.STOCK_NOT_CONFIRMED_30MIN,
          OrderEscalationType.STOCK_NOT_CONFIRMED_REPEAT,
        ])
      ) {
        continue;
      }

      const claimed = await this.prisma.partnerOrder.updateMany({
        where: { id: order.id, stockAlertLastSentAt: order.stockAlertLastSentAt },
        data: { stockAlertLastSentAt: new Date() },
      });
      if (claimed.count === 0) continue;

      await this.escalations.raise(order.id, type, {
        partnerId: order.partnerId,
        elapsedMinutes: Math.floor((Date.now() - order.createdAt.getTime()) / 60_000),
      });
      alerted += 1;
    }
    return alerted;
  }
}
