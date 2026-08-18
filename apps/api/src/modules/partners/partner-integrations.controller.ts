import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  assertPartnerOwner,
  assertPartnerScope,
  assertPlatformAdmin,
} from '../../common/auth/partner-scope';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { PartnerIntegrationsService } from './partner-integrations.service';

@ApiTags('partners')
@ApiBearerAuth()
@Controller('partners/:partnerId/integrations')
export class PartnerIntegrationsController {
  constructor(private readonly integrations: PartnerIntegrationsService) {}

  /**
   * Business decision (2026-08-18, Arman): integration requests are
   * financially significant enough (they lead to auto-finalization once
   * verified) to restrict to the OWNER tier, the same call already made for
   * `updateCommercialSettings` — MANAGER/STAFF can no longer submit or list
   * them, only view is blocked too, not just create.
   */
  @Get()
  list(@CurrentUser() user: RequestUser, @Param('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'list partner integrations');
    return this.integrations.list(partnerId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @Body() dto: CreateIntegrationDto,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'request a partner integration');
    return this.integrations.create(partnerId, dto, user.id);
  }

  /** Platform-admin-only, deliberately manual — see the service for why. */
  @Post(':integrationId/verify-website')
  verifyWebsite(
    @CurrentUser() admin: RequestUser,
    @Param('partnerId') partnerId: string,
    @Param('integrationId') integrationId: string,
  ) {
    assertPlatformAdmin(admin, 'Verifying a partner website');
    return this.integrations.markWebsiteVerified(partnerId, integrationId, admin.id);
  }
}
