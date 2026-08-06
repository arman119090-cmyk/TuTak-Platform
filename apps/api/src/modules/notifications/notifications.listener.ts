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
      });
    } catch (err) {
      this.logger.error('Failed to send transaction notification', err as Error);
    }
  }
}
