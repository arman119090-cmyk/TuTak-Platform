import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { CommerceLedgerService } from './commerce-ledger.service';

@Module({
  imports: [LedgerModule],
  providers: [CommerceLedgerService],
  exports: [CommerceLedgerService],
})
export class CommerceLedgerModule {}
