import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TransactionCompletedEvent } from '../transactions/events/transaction-completed.event';
import { ReferralService } from './referral.service';

@Injectable()
export class ReferralListener {
  private readonly logger = new Logger(ReferralListener.name);

  constructor(private readonly referralService: ReferralService) {}

  @OnEvent('transaction.completed')
  async onTransactionCompleted(event: TransactionCompletedEvent) {
    try {
      await this.referralService.handleQualifyingTransaction(event.userId, event.transactionId);
    } catch (err) {
      this.logger.error('Failed to process referral qualification', err as Error);
    }
  }
}
