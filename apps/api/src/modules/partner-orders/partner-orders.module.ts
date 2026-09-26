import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommerceLedgerModule } from '../commerce-ledger/commerce-ledger.module';
import { CommissionDistributionModule } from '../commission-distribution/commission-distribution.module';
import { CustomerBalanceModule } from '../customer-balance/customer-balance.module';
import { EmployeeShiftsModule } from '../employee-shifts/employee-shifts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PartnersModule } from '../partners/partners.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletModule } from '../wallet/wallet.module';
import { PartnerOrdersController } from './partner-orders.controller';
import { PartnerOrdersAdminController } from './partner-orders-admin.controller';
import { PartnerOrdersService } from './partner-orders.service';
import { PartnerOrderPaymentsService } from './partner-order-payments.service';
import { CommerceRulesService } from './commerce-rules.service';
import { SourcingTaskService } from './sourcing-task.service';
import { OrderEscalationService } from './order-escalation.service';
import { PartnerOrderAdjustmentService } from './partner-order-adjustment.service';
import { PartnerOrderSlaSweepService } from './partner-order-sla-sweep.service';
import { PartnerOrderNotifier } from './partner-order-notifier.service';
import { PartnerOrderApiKeyGuard } from './partner-order-api-key.guard';
import { PartnerOrderReturnsService } from './partner-order-returns.service';
import { OrderDisputesService } from './order-disputes.service';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';

/**
 * Partner Commerce — online partner orders (docs/PARTNER_COMMERCE.md).
 * Builds only on existing primitives: `PartnerApiKey` for the website's
 * server-to-server auth, the double-entry ledger (through
 * `CommerceLedgerService`) for the escrow, the bonus engine for the
 * discount balance, `CommissionDistributionService` for the 20/30/30/20
 * split, `EmployeeShiftService` for cash-desk actions, `AlertsService` and
 * `NotificationsService` for alerts and notifications.
 */
@Module({
  imports: [
    AuditModule,
    CommerceLedgerModule,
    CommissionDistributionModule,
    CustomerBalanceModule,
    EmployeeShiftsModule,
    NotificationsModule,
    LedgerModule,
    PartnersModule,
    ReferralModule,
    TransactionsModule,
    WalletModule,
  ],
  controllers: [PartnerOrdersController, PartnerOrdersAdminController],
  providers: [
    PartnerOrdersService,
    PartnerOrderPaymentsService,
    CommerceRulesService,
    SourcingTaskService,
    OrderEscalationService,
    PartnerOrderAdjustmentService,
    PartnerOrderSlaSweepService,
    PartnerOrderNotifier,
    PartnerOrderReturnsService,
    OrderDisputesService,
    PartnerOrderApiKeyGuard,
  ],
  exports: [
    PartnerOrdersService,
    PartnerOrderPaymentsService,
    CommerceRulesService,
    SourcingTaskService,
    OrderEscalationService,
    PartnerOrderAdjustmentService,
    PartnerOrderSlaSweepService,
    PartnerOrderNotifier,
    PartnerOrderReturnsService,
    OrderDisputesService,
  ],
})
export class PartnerOrdersModule {}
