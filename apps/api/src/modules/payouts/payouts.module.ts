import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SettlementModule } from '../settlement/settlement.module';
import { PayoutsController } from './payouts.controller';
import { PayoutEngineService } from './payout-engine.service';

@Module({
  imports: [LedgerModule, AuditModule, SettlementModule],
  controllers: [PayoutsController],
  providers: [PayoutEngineService],
  exports: [PayoutEngineService],
})
export class PayoutsModule {}
