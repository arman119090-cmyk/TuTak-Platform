import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PartnersModule } from '../partners/partners.module';
import { ReferralModule } from '../referral/referral.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletModule } from '../wallet/wallet.module';
import { PurchaseIntentsController } from './purchase-intents.controller';
import { PurchaseIntentsService } from './purchase-intents.service';

@Module({
  imports: [AuditModule, LedgerModule, PartnersModule, ReferralModule, TransactionsModule, WalletModule],
  controllers: [PurchaseIntentsController],
  providers: [PurchaseIntentsService],
  exports: [PurchaseIntentsService],
})
export class PurchaseIntentsModule {}
