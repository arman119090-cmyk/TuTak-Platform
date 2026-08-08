import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserRegisteredEvent } from '../auth/auth.service';
import { TransactionCompletedEvent } from '../transactions/events/transaction-completed.event';
import { NotificationsService } from './notifications.service';

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
        // notification is composed once, by the server, and never again.
        push: { title: 'Welcome to TuTak', body: 'Your bonus wallet is ready.' },
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
        push: { title: 'Payment complete', body: `${event.amount} AMD paid.` },
      });
    } catch (err) {
      this.logger.error('Failed to send transaction notification', err as Error);
    }
  }
}
