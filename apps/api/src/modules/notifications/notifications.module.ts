import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { PushDispatchService } from './push-dispatch.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener, PushDispatchService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
