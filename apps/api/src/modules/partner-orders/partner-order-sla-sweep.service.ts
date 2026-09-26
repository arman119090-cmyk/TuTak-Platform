import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  OrderEscalationType,
  PartnerOrderOperationalStatus as Op,
  PaymentLegStatus,
  PaymentLegType,
} from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrderEscalationService } from './order-escalation.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';
import { PartnerOrdersService } from './partner-orders.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Every Partner Commerce timer, driven by `sweeps.jobs.ts` (BullMQ
 * repeatable jobs on Redis) the same way every other timed effect in this
 * codebase is: a timestamp column plus a sweep that runs far more often
 * than the deadline — never a process-local `setTimeout` (spec §18.1). Each
 * effect is claimed with a conditional UPDATE, so two workers running the
 * same sweep never double-alert.
 *
 * Every partner SLA is measured from `submittedAt` (v1 error E3 fixed): an
 * abandoned DRAFT never has one, and "Увидел заказ" at minute 29 buys no
 * extra time for the 30-minute stock deadline.
 */
@Injectable()
export class PartnerOrderSlaSweepService {
  private readonly logger = new Logger(PartnerOrderSlaSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalations: OrderEscalationService,
    private readonly orders: PartnerOrdersService,
    private readonly notifier: PartnerOrderNotifier,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private policy() {
    return this.config.get('partnerOrderPolicy', { infer: true });
  }

  /** Spec §17: 5 minutes after submit, still not "Увидел". Once per order. */
  async sweepNotSeen(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.policy().notSeenAlertMinutes * MINUTE);
    const overdue = await this.prisma.partnerOrder.findMany({
      where: { operationalStatus: Op.SUBMITTED, notSeenAlertSentAt: null, submittedAt: { lt: cutoff } },
    });
    let alerted = 0;
    for (const order of overdue) {
      const claimed = await this.prisma.partnerOrder.updateMany({
        where: { id: order.id, notSeenAlertSentAt: null, operationalStatus: Op.SUBMITTED },
        data: { notSeenAlertSentAt: now },
      });
      if (claimed.count === 0) continue;
      await this.escalations.raise(order, OrderEscalationType.NOT_SEEN_5MIN, `partner-order.not-seen:${order.id}`);
      alerted += 1;
    }
    return alerted;
  }

  /**
   * Spec §18: 30 minutes after submit with no stock decision → critical;
   * then every 5 minutes (30, 35, 40 …) until it is decided. A problem an
   * operator has claimed ("Взял в работу") is not re-pushed, but the order
   * stays in the queue.
   */
  async sweepStockNotConfirmed(now = new Date()): Promise<number> {
    const { stockConfirmDeadlineMinutes, stockAlertRepeatMinutes } = this.policy();
    const cutoff = new Date(now.getTime() - stockConfirmDeadlineMinutes * MINUTE);
    const overdue = await this.prisma.partnerOrder.findMany({
      where: { operationalStatus: { in: [Op.SUBMITTED, Op.SEEN] }, submittedAt: { lt: cutoff } },
    });
    let alerted = 0;
    for (const order of overdue) {
      const first = order.stockAlertLastSentAt === null;
      if (!first && now.getTime() - order.stockAlertLastSentAt!.getTime() < stockAlertRepeatMinutes * MINUTE) continue;
      if (
        await this.escalations.hasClaimedOpenEscalation(order.id, [
          OrderEscalationType.STOCK_NOT_CONFIRMED_30MIN,
          OrderEscalationType.STOCK_NOT_CONFIRMED_REPEAT,
        ])
      ) {
        continue;
      }
      const claimed = await this.prisma.partnerOrder.updateMany({
        where: {
          id: order.id,
          stockAlertLastSentAt: order.stockAlertLastSentAt,
          operationalStatus: { in: [Op.SUBMITTED, Op.SEEN] },
        },
        data: { stockAlertLastSentAt: now },
      });
      if (claimed.count === 0) continue;
      const elapsed = Math.floor((now.getTime() - order.submittedAt!.getTime()) / MINUTE);
      await this.escalations.raise(
        order,
        first ? OrderEscalationType.STOCK_NOT_CONFIRMED_30MIN : OrderEscalationType.STOCK_NOT_CONFIRMED_REPEAT,
        // Unique per tick: the alert channel's own 15-minute suppression must
        // not swallow the 35/40/45-minute repeats spec §18.1 asks for.
        `partner-order.stock-sla:${order.id}:${elapsed}`,
      );
      alerted += 1;
    }
    return alerted;
  }

  /**
   * Spec §34 / Q3: handed over 24h ago and not confirmed → remind the
   * customer (once); 48h → TuTak manual review. Never releases the escrow —
   * that only ever happens on the customer's own confirmation or an admin
   * decision.
   */
  async sweepReceipt(now = new Date()): Promise<{ reminded: number; manualReview: number }> {
    const { receiptReminderHours, receiptManualReviewHours } = this.policy();
    let reminded = 0;
    let manualReview = 0;

    const toRemind = await this.prisma.partnerOrder.findMany({
      where: {
        operationalStatus: Op.HANDED_OVER,
        receiptReminderSentAt: null,
        handedOverAt: { lt: new Date(now.getTime() - receiptReminderHours * HOUR) },
      },
    });
    for (const order of toRemind) {
      const claimed = await this.prisma.partnerOrder.updateMany({
        where: { id: order.id, receiptReminderSentAt: null, operationalStatus: Op.HANDED_OVER },
        data: { receiptReminderSentAt: now },
      });
      if (claimed.count === 0) continue;
      await this.notifier.receiptReminder(order);
      reminded += 1;
    }

    const toReview = await this.prisma.partnerOrder.findMany({
      where: {
        operationalStatus: Op.HANDED_OVER,
        manualReviewAt: null,
        handedOverAt: { lt: new Date(now.getTime() - receiptManualReviewHours * HOUR) },
      },
    });
    for (const order of toReview) {
      const claimed = await this.prisma.partnerOrder.updateMany({
        where: { id: order.id, manualReviewAt: null, operationalStatus: Op.HANDED_OVER },
        data: { manualReviewAt: now, manualReviewReason: 'receipt_not_confirmed_48h' },
      });
      if (claimed.count === 0) continue;
      await this.auditService.record({
        action: AuditAction.PARTNER_ORDER_MANUAL_REVIEW,
        entityType: 'PartnerOrder',
        entityId: order.id,
        metadata: { reason: 'receipt_not_confirmed_48h' },
      });
      await this.escalations.raise(order, OrderEscalationType.RECEIPT_NOT_CONFIRMED_48H, `partner-order.receipt-48h:${order.id}`);
      manualReview += 1;
    }
    return { reminded, manualReview };
  }

  /**
   * Interim rule pending Q10: the customer confirmed receipt but an external
   * leg is still unconfirmed past the grace window → "Payment issue". The
   * escrow stays where it is.
   */
  async sweepPaymentIssues(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.policy().paymentIssueHours * HOUR);
    const stuck = await this.prisma.partnerOrder.findMany({
      where: {
        operationalStatus: Op.RECEIVED,
        paymentIssueAt: null,
        customerReceivedAt: { lt: cutoff },
        paymentLegs: { some: { type: PaymentLegType.EXTERNAL, status: PaymentLegStatus.PENDING } },
      },
    });
    let flagged = 0;
    for (const order of stuck) {
      const claimed = await this.prisma.partnerOrder.updateMany({
        where: { id: order.id, paymentIssueAt: null, operationalStatus: Op.RECEIVED },
        data: { paymentIssueAt: now },
      });
      if (claimed.count === 0) continue;
      await this.escalations.raise(order, OrderEscalationType.PAYMENT_ISSUE, `partner-order.payment-issue:${order.id}`);
      flagged += 1;
    }
    return flagged;
  }

  expireDrafts(now = new Date()): Promise<number> {
    return this.orders.expireStaleDrafts(now);
  }
}
