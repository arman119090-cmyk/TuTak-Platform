import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SettlementModule } from '../settlement/settlement.module';
import { PayoutsController } from './payouts.controller';
import { PayoutEngineService } from './payout-engine.service';
import { AcquirerSettlementService } from './acquirer-settlement.service';
import { PartnerCollectionService } from './partner-collection.service';
import { PartnerSettlementCheckService } from './partner-settlement-check.service';

@Module({
  imports: [LedgerModule, AuditModule, SettlementModule],
  controllers: [PayoutsController],
  providers: [
    PayoutEngineService,
    AcquirerSettlementService,
    PartnerCollectionService,
    PartnerSettlementCheckService,
  ],
  exports: [
    PayoutEngineService,
    AcquirerSettlementService,
    PartnerCollectionService,
    PartnerSettlementCheckService,
  ],
})
export class PayoutsModule {}
