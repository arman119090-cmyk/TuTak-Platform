import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { OutboxService } from './outbox.service';
import { OutboxSchedulerService } from './outbox-scheduler.service';

/**
 * Phase 1 of the financial core: the ledger and its posting primitive.
 *
 * No controllers. Nothing in the running product writes to this ledger yet —
 * the engines that will (payment, settlement, refund, payout) are phases 3
 * onward. Shipping the constraints and the primitive first is deliberate:
 * nothing above this layer is worth trusting until a posting cannot fail to
 * balance.
 */
@Module({
  providers: [LedgerService, OutboxService, OutboxSchedulerService],
  exports: [LedgerService, OutboxService],
})
export class LedgerModule {}
