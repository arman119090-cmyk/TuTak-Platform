import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';
import { WalletModule } from '../wallet/wallet.module';
import { CommissionDistributionService } from './commission-distribution.service';

@Module({
  imports: [LedgerModule, ReferralModule, WalletModule],
  providers: [CommissionDistributionService],
  exports: [CommissionDistributionService],
})
export class CommissionDistributionModule {}
