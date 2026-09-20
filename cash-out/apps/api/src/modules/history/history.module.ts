import { Module } from '@nestjs/common';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [WithdrawalsModule],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
