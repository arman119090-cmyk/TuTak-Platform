import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type OrderRef = { id: string; orderNumber: number; customerId: string | null; partnerId: string };

/**
 * Customer- and partner-facing Partner Commerce notifications (spec §68),
 * through the existing `NotificationsService` — the in-app inbox row plus a
 * push — never a second notification platform. Operator-facing SLA alerts
 * go through `AlertsService` instead (see `OrderEscalationService`); the
 * customer never sees those (spec §19), and nothing here ever mentions
 * internal SLA state.
 *
 * Every method swallows its own failure: a notification that could not be
 * sent must never undo or fail the financial step that triggered it.
 */
@Injectable()
export class PartnerOrderNotifier {
  private readonly logger = new Logger(PartnerOrderNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async toCustomer(order: OrderRef, key: string, push: { title: string; body: string }) {
    if (!order.customerId) return;
    await this.notifications
      .send({
        userId: order.customerId,
        titleKey: `notifications.partnerOrder.${key}Title`,
        bodyKey: `notifications.partnerOrder.${key}Body`,
        params: { orderNumber: order.orderNumber },
        push,
      })
      .catch((err) => this.logger.warn(`Customer notification ${key} for order ${order.id} failed: ${err}`));
  }

  /** Every user holding a partner-scoped role at this partner — owner, managers, staff. */
  private async toPartner(order: OrderRef, key: string) {
    const roles = await this.prisma.userRole.findMany({
      where: { partnerId: order.partnerId },
      select: { userId: true },
    });
    for (const userId of new Set(roles.map((r) => r.userId))) {
      await this.notifications
        .send({
          userId,
          titleKey: `notifications.partnerOrder.${key}Title`,
          bodyKey: `notifications.partnerOrder.${key}Body`,
          params: { orderNumber: order.orderNumber },
        })
        .catch((err) => this.logger.warn(`Partner notification ${key} for order ${order.id} failed: ${err}`));
    }
  }

  orderSubmitted(order: OrderRef) {
    return this.toPartner(order, 'newOrder');
  }

  stockConfirmed(order: OrderRef) {
    return this.toCustomer(order, 'confirmed', {
      title: `Order #${order.orderNumber} confirmed`,
      body: 'Tap "Received" once you have the order in your hands.',
    });
  }

  decisionRequired(order: OrderRef) {
    return this.toCustomer(order, 'decisionRequired', {
      title: `Order #${order.orderNumber}: your decision is needed`,
      body: 'We found an option for your order. Please review it.',
    });
  }

  externalPaymentRequired(order: OrderRef) {
    return this.toPartner(order, 'externalPaymentRequired');
  }

  receiptReminder(order: OrderRef) {
    return this.toCustomer(order, 'receiptReminder', {
      title: `Did you receive order #${order.orderNumber}?`,
      body: 'If you already have it, please confirm receipt in TuTak.',
    });
  }

  cancelled(order: OrderRef) {
    return this.toCustomer(order, 'cancelled', {
      title: `Order #${order.orderNumber} cancelled`,
      body: 'Everything you paid through TuTak has been returned.',
    });
  }

  refundCompleted(order: OrderRef) {
    return this.toCustomer(order, 'refundCompleted', {
      title: `Refund for order #${order.orderNumber}`,
      body: 'Your refund has been processed.',
    });
  }

  outForDelivery(order: OrderRef) {
    return this.toCustomer(order, 'outForDelivery', {
      title: `Order #${order.orderNumber} is on its way`,
      body: 'The partner handed it to its courier.',
    });
  }

  readyForPickup(order: OrderRef) {
    return this.toCustomer(order, 'readyForPickup', {
      title: `Order #${order.orderNumber} is ready for pickup`,
      body: 'Tap "Received" once you have it in your hands.',
    });
  }

  delivered(order: OrderRef) {
    return this.toCustomer(order, 'delivered', {
      title: `Order #${order.orderNumber} delivered`,
      body: 'The partner marked it delivered. Tap "Received" once you have it in your hands.',
    });
  }

  /** Q10: the customer confirmed receipt but an external payment is still unconfirmed. */
  paymentIssue(order: OrderRef) {
    return this.toPartner(order, 'paymentIssue');
  }

  cancellationRequested(order: OrderRef) {
    return this.toPartner(order, 'cancellationRequested');
  }

  cancellationCostClaimed(order: OrderRef) {
    return this.toCustomer(order, 'cancellationCostClaimed', {
      title: `Order #${order.orderNumber}: cancellation under review`,
      body: 'The partner reported actual costs. TuTak will review them before your refund.',
    });
  }

  cancelledWithCost(order: OrderRef) {
    return this.toCustomer(order, 'cancelledWithCost', {
      title: `Order #${order.orderNumber} cancelled`,
      body: 'Your refund has been processed minus the approved actual cost. Open the order for details.',
    });
  }

  cancellationDeclinedByPartnerCostRejected(order: OrderRef) {
    return this.toPartner(order, 'cancellationDecided');
  }

  /** Q9: a return waits for the customer's shortfall to be settled at the partner's desk. */
  returnSettlementRequired(order: OrderRef) {
    return this.toCustomer(order, 'returnSettlementRequired', {
      title: `Return for order #${order.orderNumber}`,
      body: 'Part of the bonus you received for this order was already used. Open the order to see how it is settled.',
    });
  }

  disputeCreated(order: OrderRef) {
    return this.toPartner(order, 'disputeCreated');
  }

  disputeResolved(order: OrderRef) {
    return Promise.all([
      this.toCustomer(order, 'disputeResolved', {
        title: `Dispute on order #${order.orderNumber} resolved`,
        body: 'Open the order to see the decision.',
      }),
      this.toPartner(order, 'disputeResolved'),
    ]);
  }
}
