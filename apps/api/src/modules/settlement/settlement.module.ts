import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletModule } from '../wallet/wallet.module';
import { SettlementListener } from './settlement.listener';
import { SettlementService } from './settlement.service';

@Module({
  imports: [LedgerModule, WalletModule, AuthModule],
  providers: [SettlementService, SettlementListener],
  exports: [SettlementService],
})
export class SettlementModule {}
