import { Module } from '@nestjs/common';
import { YandexModule } from '../yandex/yandex.module';
import { MembershipService } from './membership.service';
import { ParksAdminService } from './parks-admin.service';
import { MeParksController } from './parks.controller';

@Module({
  imports: [YandexModule],
  controllers: [MeParksController],
  providers: [MembershipService, ParksAdminService],
  exports: [MembershipService, ParksAdminService],
})
export class ParksModule {}
