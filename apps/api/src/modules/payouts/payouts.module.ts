import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PartnerSettlementsModule } from '../partner-settlements/partner-settlements.module';
import { SettlementModule } from '../settlement/settlement.module';
import { PayoutsController } from './payouts.controller';
import { PayoutHistoryService } from './payout-history.service';
import { AcquirerSettlementService } from './acquirer-settlement.service';
import { PartnerCollectionService } from './partner-collection.service';
import { PartnerSettlementCheckService } from './partner-settlement-check.service';
import { PartnerSettlementStatementService } from './partner-settlement-statement.service';
import { PartnerSettlementController } from './partner-settlement.controller';

@Module({
  imports: [LedgerModule, AuditModule, SettlementModule, PartnerSettlementsModule],
  controllers: [PayoutsController, PartnerSettlementController],
  providers: [
    PayoutHistoryService,
    AcquirerSettlementService,
    PartnerCollectionService,
    PartnerSettlementCheckService,
    PartnerSettlementStatementService,
  ],
  exports: [
    PayoutHistoryService,
    AcquirerSettlementService,
    PartnerCollectionService,
    PartnerSettlementCheckService,
    PartnerSettlementStatementService,
  ],
})
export class PayoutsModule {}
