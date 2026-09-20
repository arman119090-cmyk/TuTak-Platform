import { Module } from '@nestjs/common';
import { ParksModule } from '../parks/parks.module';
import { YandexModule } from '../yandex/yandex.module';
import { DriverIdController } from './driver-id.controller';
import { DriverIdService } from './driver-id.service';

@Module({
  imports: [ParksModule, YandexModule],
  controllers: [DriverIdController],
  providers: [DriverIdService],
  exports: [DriverIdService],
})
export class DriverIdModule {}
