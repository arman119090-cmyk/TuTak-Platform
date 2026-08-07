import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutEngineService } from './payout-engine.service';

@Module({
  imports: [LedgerModule],
  providers: [PayoutEngineService],
  exports: [PayoutEngineService],
})
export class PayoutsModule {}
