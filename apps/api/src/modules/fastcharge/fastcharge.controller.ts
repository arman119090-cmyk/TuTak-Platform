import { Body, Controller, Get, Post, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerScope, assertPlatformAdmin } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { FastChargePartner } from './decorators/fastcharge-partner.decorator';
import { FastChargeApiKeyGuard } from './fastcharge-api-key.guard';
import { FastChargeStationSyncDto } from './dto/fastcharge-station-sync.dto';
import { FastChargeSessionSettleDto } from './dto/fastcharge-session-settle.dto';
import { LinkFastChargeCustomerDto } from './dto/link-fastcharge-customer.dto';
import { IssuePartnerApiKeyDto } from './dto/partner-api-key.dto';
import { UpdateStationTariffDto } from './dto/update-station-tariff.dto';
import { FastChargeStationsService } from './fastcharge-stations.service';
import { FastChargeSettlementService } from './fastcharge-settlement.service';
import { FastChargeCustomersService } from './fastcharge-customers.service';
import { PartnerApiKeyService } from './partner-api-key.service';

/**
 * The inbound half of the FastCharge adapter boundary — see
 * `fastcharge-provider.interface.ts`'s docblock. Every route FastCharge
 * itself calls is `@Public()` (no TuTak user session) and instead requires
 * `FastChargeApiKeyGuard`'s M2M credential. Every other route here is an
 * ordinary TuTak-session route (mobile customer, or partner/admin
 * dashboard) behind the global JWT guard.
 */
@ApiTags('fastcharge')
@Controller('fastcharge')
export class FastChargeController {
  constructor(
    private readonly stations: FastChargeStationsService,
    private readonly settlement: FastChargeSettlementService,
    private readonly customers: FastChargeCustomersService,
    private readonly apiKeys: PartnerApiKeyService,
  ) {}

  // ── FastCharge → TuTak (M2M) ──────────────────────────────────────────

  @Post('stations/sync')
  @Public()
  @UseGuards(FastChargeApiKeyGuard)
  syncStation(@FastChargePartner() partnerId: string, @Body() dto: FastChargeStationSyncDto) {
    return this.stations.sync(partnerId, dto);
  }

  @Post('sessions/settle')
  @Public()
  @UseGuards(FastChargeApiKeyGuard)
  settleSession(@FastChargePartner() partnerId: string, @Body() dto: FastChargeSessionSettleDto) {
    return this.settlement.settle(partnerId, dto);
  }

  // ── Mobile customer ─────────────────────────────────────────────────

  /** A TuTak user linking their own FastCharge customer id to their account. */
  @Post('customers/link')
  linkCustomer(@CurrentUser() user: RequestUser, @Body() dto: LinkFastChargeCustomerDto) {
    return this.customers.link(user.id, dto.partnerId, dto.fastChargeCustomerId);
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
    assertPlatformAdmin(user, 'Issuing a FastCharge M2M API key');
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
