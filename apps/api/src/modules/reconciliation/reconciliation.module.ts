import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [LedgerModule, AuditModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
