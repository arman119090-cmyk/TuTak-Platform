import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReferralController } from './referral.controller';
import { ReferralListener } from './referral.listener';
import { ReferralService } from './referral.service';

@Module({
  imports: [WalletModule, AuditModule],
  controllers: [ReferralController],
  providers: [ReferralService, ReferralListener],
  exports: [ReferralService],
})
export class ReferralModule {}
