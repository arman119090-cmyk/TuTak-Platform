import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MediaModule } from '../media/media.module';
import { PartnersModule } from '../partners/partners.module';
import { ReferralModule } from '../referral/referral.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletModule } from '../wallet/wallet.module';
import { PurchaseIntentRefundRequestService } from './purchase-intent-refund-request.service';
import { PurchaseIntentRefundRequestsController } from './purchase-intent-refund-requests.controller';
import { PurchaseIntentRefundService } from './purchase-intent-refund.service';
import { PurchaseIntentsController } from './purchase-intents.controller';
import { PurchaseIntentsService } from './purchase-intents.service';

@Module({
  imports: [AuditModule, LedgerModule, MediaModule, PartnersModule, ReferralModule, TransactionsModule, WalletModule],
  controllers: [PurchaseIntentsController, PurchaseIntentRefundRequestsController],
  providers: [PurchaseIntentsService, PurchaseIntentRefundService, PurchaseIntentRefundRequestService],
  exports: [PurchaseIntentsService, PurchaseIntentRefundService, PurchaseIntentRefundRequestService],
})
export class PurchaseIntentsModule {}
