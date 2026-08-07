import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReferralController } from './referral.controller';
import { ReferralListener } from './referral.listener';
import { ReferralService } from './referral.service';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [WalletModule, AuditModule, LedgerModule],
  controllers: [ReferralController],
  providers: [ReferralService, ReferralListener],
  exports: [ReferralService],
})
export class ReferralModule {}
