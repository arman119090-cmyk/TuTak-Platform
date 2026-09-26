import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReferralModule } from '../referral/referral.module';
import { WalletModule } from '../wallet/wallet.module';
import { CommerceReversalService } from './commerce-reversal.service';
import { CommissionDistributionService } from './commission-distribution.service';

@Module({
  imports: [AuditModule, LedgerModule, ReferralModule, WalletModule],
  providers: [CommissionDistributionService, CommerceReversalService],
  exports: [CommissionDistributionService, CommerceReversalService],
})
export class CommissionDistributionModule {}
