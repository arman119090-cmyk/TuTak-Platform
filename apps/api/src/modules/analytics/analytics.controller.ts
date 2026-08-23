import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { hasPartnerScope, isPlatformAdmin } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRangeDto } from './dto/analytics-range.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('partners/:partnerId')
  @RequirePermissions(PermissionName.ANALYTICS_READ)
  async partner(
    @CurrentUser() user: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @Query() query: AnalyticsRangeDto,
  ) {
    if (!hasPartnerScope(user, partnerId)) {
      throw new ForbiddenException('You do not have analytics access for this partner');
    }
    return this.analyticsService.partnerAnalytics(
      partnerId,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  /**
   * ANALYTICS_READ is held by PARTNER_OWNER, so gating on the permission alone
   * exposed platform-wide volumes and the total outstanding bonus liability to
   * every partner on the network (audit §H8). Platform figures are admin-only.
   */
  @Get('platform')
  @RequirePermissions(PermissionName.ANALYTICS_READ)
  platform(@CurrentUser() user: RequestUser) {
    if (!isPlatformAdmin(user)) {
      throw new ForbiddenException('Platform analytics are restricted to administrators');
    }
    return this.analyticsService.platformOverview();
  }
}
