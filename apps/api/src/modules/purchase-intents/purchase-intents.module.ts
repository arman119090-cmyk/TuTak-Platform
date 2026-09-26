import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommissionDistributionModule } from '../commission-distribution/commission-distribution.module';
import { CommerceLedgerModule } from '../commerce-ledger/commerce-ledger.module';
import { EmployeeShiftsModule } from '../employee-shifts/employee-shifts.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MediaModule } from '../media/media.module';
import { PartnersModule } from '../partners/partners.module';
import { PspAdapterModule } from '../psp/psp-adapter.module';
import { ReferralModule } from '../referral/referral.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletModule } from '../wallet/wallet.module';
import { PurchaseIntentRefundRequestService } from './purchase-intent-refund-request.service';
import { PurchaseIntentRefundRequestsController } from './purchase-intent-refund-requests.controller';
import { PurchaseIntentRefundService } from './purchase-intent-refund.service';
import { PurchaseIntentsController } from './purchase-intents.controller';
import { PurchaseIntentsService } from './purchase-intents.service';

@Module({
  imports: [
    AuditModule,
    CommerceLedgerModule,
    CommissionDistributionModule,
    EmployeeShiftsModule,
    LedgerModule,
    MediaModule,
    PartnersModule,
    // The provider adapter alone, never `PspModule` — that one imports this
    // module, and the refund path only needs to ask what the provider can do.
    PspAdapterModule,
    ReferralModule,
    TransactionsModule,
    WalletModule,
  ],
  controllers: [PurchaseIntentsController, PurchaseIntentRefundRequestsController],
  providers: [
    PurchaseIntentsService,
    PurchaseIntentRefundService,
    PurchaseIntentRefundRequestService,
  ],
  exports: [
    PurchaseIntentsService,
    PurchaseIntentRefundService,
    PurchaseIntentRefundRequestService,
  ],
})
export class PurchaseIntentsModule {}
