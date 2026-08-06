import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('partners/:partnerId')
  @RequirePermissions(PermissionName.ANALYTICS_READ)
  async partner(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const isAdmin = user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN');
    const ownsPartner = Object.values(user.partnerScopes).some((ids) => ids.includes(partnerId));
    if (!isAdmin && !ownsPartner) {
      throw new ForbiddenException('You do not have analytics access for this partner');
    }
    return this.analyticsService.partnerAnalytics(partnerId, from, to);
  }

  @Get('platform')
  @RequirePermissions(PermissionName.ANALYTICS_READ)
  platform() {
    return this.analyticsService.platformOverview();
  }
}
