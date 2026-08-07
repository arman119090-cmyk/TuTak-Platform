import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OutboxService } from '../ledger/outbox.service';
import { SettlementService } from './settlement.service';

/**
 * Drives settlement off `payment.captured`, written to the outbox in the same
 * transaction as the capture itself — so a payment that captured always
 * settles eventually, even if this process dies between the two.
 */
@Injectable()
export class SettlementListener implements OnModuleInit {
  private readonly logger = new Logger(SettlementListener.name);

  constructor(
    private readonly settlement: SettlementService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.outbox.register('payment.captured', async (payload) => {
      // Thrown errors are the retry signal: the outbox backs off and tries
      // again rather than swallowing the failure. `settlePayment` is
      // idempotent, so a retry after a partial failure is safe.
      await this.settlement.settlePayment(payload.paymentId as string);
    });
  }
}
