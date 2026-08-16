import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { assertPartnerScope, assertPlatformAdmin } from '../../common/auth/partner-scope';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { PartnerIntegrationsService } from './partner-integrations.service';

@ApiTags('partners')
@ApiBearerAuth()
@Controller('partners/:partnerId/integrations')
export class PartnerIntegrationsController {
  constructor(private readonly integrations: PartnerIntegrationsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.integrations.list(partnerId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param('partnerId') partnerId: string,
    @Body() dto: CreateIntegrationDto,
  ) {
    assertPartnerScope(user, partnerId);
    return this.integrations.create(partnerId, dto, user.id);
  }

  /** Platform-admin-only, deliberately manual — see the service for why. */
  @Post(':integrationId/verify-website')
  verifyWebsite(
    @CurrentUser() admin: RequestUser,
    @Param('integrationId') integrationId: string,
  ) {
    assertPlatformAdmin(admin, 'Verifying a partner website');
    return this.integrations.markWebsiteVerified(integrationId, admin.id);
  }
}
