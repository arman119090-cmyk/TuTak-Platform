import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/request-user.type';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  list(@CurrentUser() user: RequestUser, @Query() query: CursorPaginationQueryDto) {
    return this.notificationsService.listMine(user.id, query);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.notificationsService.markRead(id, user.id);
  }

  /**
   * Registers the device this caller wants notified.
   *
   * Scoped to the authenticated user, never to a user id in the body: the
   * token decides whose device this is, so nobody can point their own phone
   * at someone else's notifications.
   */
  @Post('push-token')
  registerPushToken(@CurrentUser() user: RequestUser, @Body() dto: RegisterPushTokenDto) {
    return this.notificationsService.registerPushToken({ userId: user.id, ...dto });
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notificationsService.markAllRead(user.id);
  }
}
