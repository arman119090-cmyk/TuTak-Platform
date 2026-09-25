import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { CustomerBalanceModule } from '../customer-balance/customer-balance.module';
import { PartnersModule } from '../partners/partners.module';
import { PartnerOrdersController } from './partner-orders.controller';
import { PartnerOrdersAdminController } from './partner-orders-admin.controller';
import { PartnerOrdersService } from './partner-orders.service';
import { CommissionRuleService } from './commission-rule.service';
import { SourcingTaskService } from './sourcing-task.service';
import { OrderEscalationService } from './order-escalation.service';
import { PartnerOrderAdjustmentService } from './partner-order-adjustment.service';
import { PartnerOrderSlaSweepService } from './partner-order-sla-sweep.service';
import { PartnerOrderApiKeyGuard } from './partner-order-api-key.guard';

/**
 * Partner Commerce (docs/PARTNER_COMMERCE_2026-09-25.md) — spec §1-33.
 * `PartnerApiKeyService` (M2M order-creation auth) comes through
 * `PartnersModule`, which now exports it — see that service's own docblock
 * for why it moved out of `roaming-cpo` first.
 */
@Module({
  imports: [AuditModule, LedgerModule, CustomerBalanceModule, PartnersModule],
  controllers: [PartnerOrdersController, PartnerOrdersAdminController],
  providers: [
    PartnerOrdersService,
    CommissionRuleService,
    SourcingTaskService,
    OrderEscalationService,
    PartnerOrderAdjustmentService,
    PartnerOrderSlaSweepService,
    PartnerOrderApiKeyGuard,
  ],
  exports: [
    PartnerOrdersService,
    CommissionRuleService,
    SourcingTaskService,
    OrderEscalationService,
    PartnerOrderAdjustmentService,
    PartnerOrderSlaSweepService,
  ],
})
export class PartnerOrdersModule {}
