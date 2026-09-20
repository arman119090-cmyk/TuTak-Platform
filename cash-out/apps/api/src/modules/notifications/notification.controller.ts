import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  registerPushTokenSchema,
  updateNotificationPreferencesSchema,
  type RegisterPushTokenDto,
  type UpdateNotificationPreferencesDto,
} from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId } from '../auth/auth.decorators';
import { NotificationService } from './notification.service';

@Controller('v1/notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('preferences')
  async preferences(@CurrentDriverId() driverId: string) {
    return this.notifications.preferences(driverId);
  }

  @Put('preferences')
  async update(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(updateNotificationPreferencesSchema)) dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(driverId, dto);
  }

  /** Stores the device's push token. With the mock provider it is never used. */
  @Post('push-token')
  @HttpCode(204)
  async pushToken(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(registerPushTokenSchema)) dto: RegisterPushTokenDto,
  ) {
    await this.notifications.registerPushToken(driverId, dto.token, dto.platform);
  }
}
