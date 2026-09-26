import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

/**
 * Bookkeeping exports. Reads the ledger, writes nothing.
 *
 * No `LedgerModule` import: this module deliberately does not post, reverse
 * or adjust anything, and not holding a reference to the service that can is
 * the cheapest way to keep it that way.
 */
@Module({
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
