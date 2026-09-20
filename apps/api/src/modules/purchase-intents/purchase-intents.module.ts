import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomerBalanceModule } from '../customer-balance/customer-balance.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MediaModule } from '../media/media.module';
import { PartnersModule } from '../partners/partners.module';
import { PspAdapterModule } from '../psp/psp-adapter.module';
import { ReferralModule } from '../referral/referral.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletModule } from '../wallet/wallet.module';
import { PurchaseFundingService } from './purchase-funding.service';
import { PurchaseIntentRefundRequestService } from './purchase-intent-refund-request.service';
import { PurchaseIntentRefundRequestsController } from './purchase-intent-refund-requests.controller';
import { PurchaseIntentRefundService } from './purchase-intent-refund.service';
import { PurchaseIntentsController } from './purchase-intents.controller';
import { PurchaseIntentsService } from './purchase-intents.service';

@Module({
  imports: [
    AuditModule,
    // The customer's stored money — the prepaid funding component. Imports
    // only `LedgerModule` itself, so no cycle.
    CustomerBalanceModule,
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
    PurchaseFundingService,
    PurchaseIntentRefundService,
    PurchaseIntentRefundRequestService,
  ],
  exports: [
    PurchaseIntentsService,
    PurchaseFundingService,
    PurchaseIntentRefundService,
    PurchaseIntentRefundRequestService,
  ],
})
export class PurchaseIntentsModule {}
