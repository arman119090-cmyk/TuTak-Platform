import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [LedgerModule],
  providers: [ReconciliationService, ReconciliationScheduler],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
