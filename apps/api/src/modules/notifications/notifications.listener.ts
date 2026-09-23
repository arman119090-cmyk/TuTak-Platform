import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserRegisteredEvent } from '../auth/auth.service';
import { TransactionCompletedEvent } from '../transactions/events/transaction-completed.event';
import { NotificationsService } from './notifications.service';
import { formatPushAmount, pushText } from './push-text';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('auth.user.registered')
  async onUserRegistered(event: UserRegisteredEvent) {
    try {
      await this.notificationsService.send({
        userId: event.userId,
        titleKey: 'notifications.welcomeTitle',
        bodyKey: 'notifications.welcomeBody',
        // Written out rather than keyed: the row keeps keys so the app can
        // re-render in whatever language the user later picks, but a push
        // notification is composed once, by the server, and never again —
        // so it is composed in the language the customer chose.
        push: pushText('welcome', await this.notificationsService.localeOf(event.userId)),
      });
    } catch (err) {
      this.logger.error('Failed to send welcome notification', err as Error);
    }
  }

  @OnEvent('transaction.completed')
  async onTransactionCompleted(event: TransactionCompletedEvent) {
    try {
      await this.notificationsService.send({
        userId: event.userId,
        titleKey: 'notifications.transactionCompletedTitle',
        bodyKey: 'notifications.transactionCompletedBody',
        params: { amount: event.amount, type: event.type },
        push: pushText('paymentCompleted', await this.notificationsService.localeOf(event.userId), {
          amount: formatPushAmount(event.amount),
        }),
      });
    } catch (err) {
      this.logger.error('Failed to send transaction notification', err as Error);
    }
  }
}
