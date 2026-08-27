import { Body, Controller, Get, Post, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerScope, assertPlatformAdmin } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { RoamingCpoPartner } from './decorators/roaming-cpo-partner.decorator';
import { RoamingCpoApiKeyGuard } from './roaming-cpo-api-key.guard';
import { RoamingCpoStationSyncDto } from './dto/roaming-cpo-station-sync.dto';
import { RoamingCpoSessionSettleDto } from './dto/roaming-cpo-session-settle.dto';
import { LinkRoamingCpoCustomerDto } from './dto/link-roaming-cpo-customer.dto';
import { IssuePartnerApiKeyDto } from './dto/partner-api-key.dto';
import { UpdateStationTariffDto } from './dto/update-station-tariff.dto';
import { RoamingCpoStationsService } from './roaming-cpo-stations.service';
import { RoamingCpoSettlementService } from './roaming-cpo-settlement.service';
import { RoamingCpoCustomersService } from './roaming-cpo-customers.service';
import { PartnerApiKeyService } from './partner-api-key.service';

/**
 * The inbound half of the roaming-CPO adapter boundary — see
 * `roaming-cpo-provider.interface.ts`'s docblock. Every route the partner
 * itself calls is `@Public()` (no TuTak user session) and instead requires
 * `RoamingCpoApiKeyGuard`'s M2M credential. Every other route here is an
 * ordinary TuTak-session route (mobile customer, or partner/admin
 * dashboard) behind the global JWT guard.
 */
@ApiTags('roaming-cpo')
@Controller('roaming-cpo')
export class RoamingCpoController {
  constructor(
    private readonly stations: RoamingCpoStationsService,
    private readonly settlement: RoamingCpoSettlementService,
    private readonly customers: RoamingCpoCustomersService,
    private readonly apiKeys: PartnerApiKeyService,
  ) {}

  // ── Partner → TuTak (M2M) ──────────────────────────────────────────────

  @Post('stations/sync')
  @Public()
  @UseGuards(RoamingCpoApiKeyGuard)
  syncStation(@RoamingCpoPartner() partnerId: string, @Body() dto: RoamingCpoStationSyncDto) {
    return this.stations.sync(partnerId, dto);
  }

  @Post('sessions/settle')
  @Public()
  @UseGuards(RoamingCpoApiKeyGuard)
  settleSession(@RoamingCpoPartner() partnerId: string, @Body() dto: RoamingCpoSessionSettleDto) {
    return this.settlement.settle(partnerId, dto);
  }

  // ── Mobile customer ─────────────────────────────────────────────────

  /** A TuTak user linking their own roaming-CPO customer id to their account. */
  @Post('customers/link')
  linkCustomer(@CurrentUser() user: RequestUser, @Body() dto: LinkRoamingCpoCustomerDto) {
    return this.customers.link(user.id, dto.partnerId, dto.externalCustomerId);
  }

  @Get('customers/me')
  myLinks(@CurrentUser() user: RequestUser) {
    return this.customers.findLinksForUser(user.id);
  }

  // ── Partner/admin dashboard ─────────────────────────────────────────

  @Get('stations')
  @RequirePermissions(PermissionName.EV_STATION_MANAGE)
  listStations(@CurrentUser() user: RequestUser, @Query('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.stations.listForPartner(partnerId);
  }

  @Patch('stations/:id/tariff')
  @RequirePermissions(PermissionName.EV_STATION_MANAGE)
  async updateStationTariff(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: UpdateStationTariffDto,
  ) {
    // Read-only lookup first, scope checked against *that*, and only then
    // the write — checking scope against the result of the write itself
    // would let an unauthorized write happen and be visible before the
    // scope check has a chance to refuse it.
    const station = await this.stations.findStationOrThrow(id);
    assertPartnerScope(user, station.partnerId);
    return this.stations.updateTariff(id, dto.standardRetailRatePerKwh);
  }

  /** Issuing an M2M credential is platform-admin-only — see requirement 3's "not a human login/password". */
  @Post('api-keys')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  issueApiKey(@CurrentUser() user: RequestUser, @Body() dto: IssuePartnerApiKeyDto) {
    assertPlatformAdmin(user, 'Issuing a roaming-CPO M2M API key');
    return this.apiKeys.issue(dto);
  }

  @Get('api-keys')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  listApiKeys(@CurrentUser() user: RequestUser, @Query('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.apiKeys.list(partnerId);
  }

  @Post('api-keys/:id/revoke')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async revokeApiKey(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') id: string,
    @Query('partnerId') partnerId: string,
  ) {
    assertPartnerScope(user, partnerId);
    return { revoked: await this.apiKeys.revoke(id, partnerId) };
  }
}
