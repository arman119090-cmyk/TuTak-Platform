import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import {
  PartnerSettlementAdminController,
  PartnerSettlementPartnerController,
} from './partner-settlement.controller';
import { PartnerSettlementService } from './partner-settlement.service';

/**
 * The partner settlement engine.
 *
 * Deliberately separate from `PayoutsModule`: that module is the legacy
 * ad-hoc payout (a partner asks, an admin sends), this one is the periodic
 * settlement approved on 14.09.2026. They share the ledger rather than
 * sharing a service, so neither has to grow a flag for the other's shape.
 */
@Module({
  imports: [LedgerModule, AuditModule],
  controllers: [PartnerSettlementAdminController, PartnerSettlementPartnerController],
  providers: [PartnerSettlementService],
  exports: [PartnerSettlementService],
})
export class PartnerSettlementsModule {}
