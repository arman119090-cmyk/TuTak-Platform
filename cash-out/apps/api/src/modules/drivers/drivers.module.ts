import { Module } from '@nestjs/common';
import { ParksModule } from '../parks/parks.module';
import { YandexModule } from '../yandex/yandex.module';
import { BalanceService } from './balance.service';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  imports: [YandexModule, ParksModule],
  controllers: [DriversController],
  providers: [DriversService, BalanceService],
  exports: [DriversService, BalanceService],
})
export class DriversModule {}
