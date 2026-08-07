import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OutboxService } from '../ledger/outbox.service';
import { ReferralService } from './referral.service';

/**
 * Referral qualification, driven by the outbox rather than an in-process
 * event.
 *
 * The reward is money. Losing it because a process died between the
 * transaction completing and a listener running is not an acceptable failure
 * mode, and it was silent — the old listener caught the error, logged it, and
 * the referral stayed PENDING forever with nothing to retry it.
 *
 * At-least-once delivery is safe here without any extra work: the invite is
 * claimed with a conditional update on `status: PENDING`, so a redelivery
 * finds it already claimed and does nothing.
 */
@Injectable()
export class ReferralListener implements OnModuleInit {
  private readonly logger = new Logger(ReferralListener.name);

  constructor(
    private readonly referralService: ReferralService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.outbox.register('transaction.completed', async (payload) => {
      // Thrown errors are the signal to retry — the outbox backs off and
      // tries again rather than swallowing the failure.
      await this.referralService.handleQualifyingTransaction(
        payload.userId as string,
        payload.transactionId as string,
      );
    });
  }
}
