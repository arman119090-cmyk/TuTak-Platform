import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { PermissionName } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { assertPartnerScope, resolveOperatorPartner } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { CreateConnectorDto } from './dto/create-connector.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { CreateStationDto } from './dto/create-station.dto';
import { MeterValueDto, StartSessionDto, StopSessionDto } from './dto/start-session.dto';
import { EvReservationsService } from './ev-reservations.service';
import { EvSessionsService } from './ev-sessions.service';
import { EvStationsService } from './ev-stations.service';

class NearbyQueryDto {
  @Type(() => Number)
  @IsNumber()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  lng: number;

  @Type(() => Number)
  @IsNumber()
  radiusKm: number = 10;
}

@ApiTags('ev-charging')
@ApiBearerAuth()
@Controller('ev')
export class EvChargingController {
  constructor(
    private readonly stationsService: EvStationsService,
    private readonly sessionsService: EvSessionsService,
    private readonly reservationsService: EvReservationsService,
  ) {}

  @Get('stations')
  listStations() {
    return this.stationsService.listAll();
  }

  @Get('stations/nearby')
  nearby(@Query() query: NearbyQueryDto) {
    return this.stationsService.listNearby(query.lat, query.lng, query.radiusKm);
  }

  @Get('stations/:id')
  getStation(@Param('id') id: string) {
    return this.stationsService.findStationOrThrow(id);
  }

  /**
   * Holding EV_STATION_MANAGE is not enough: the permission says *what* the
   * caller may do, `partnerScopes` says *whose* assets they may do it to.
   * Without the second check a partner could create stations, and set the
   * per-kWh price driving accrual, under a competitor's account (audit §H5).
   */
  @Post('stations')
  @RequirePermissions(PermissionName.EV_STATION_MANAGE)
  createStation(@CurrentUser() user: RequestUser, @Body() dto: CreateStationDto) {
    assertPartnerScope(user, dto.partnerId);
    return this.stationsService.createStation(dto);
  }

  @Post('connectors')
  @RequirePermissions(PermissionName.EV_STATION_MANAGE)
  async createConnector(@CurrentUser() user: RequestUser, @Body() dto: CreateConnectorDto) {
    const station = await this.stationsService.findStationOrThrow(dto.stationId);
    assertPartnerScope(user, station.partnerId);
    return this.stationsService.createConnector(dto);
  }

  @Post('reservations')
  createReservation(@CurrentUser() user: RequestUser, @Body() dto: CreateReservationDto) {
    return this.reservationsService.create(dto, user.id);
  }

  @Post('reservations/:id/cancel')
  cancelReservation(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.reservationsService.cancel(id, user.id);
  }

  @Get('reservations/me')
  myReservations(@CurrentUser() user: RequestUser) {
    return this.reservationsService.listMine(user.id);
  }

  @Post('sessions/start')
  startSession(@CurrentUser() user: RequestUser, @Body() dto: StartSessionDto) {
    return this.sessionsService.start(dto, user.id);
  }

  /**
   * Telemetry ingestion. Bounded by session ownership, or by the station's
   * partner when an operator reports on a charge point's behalf — the energy
   * reported here is the entire basis of the bill (audit §C1).
   */
  @Post('sessions/:id/meter-value')
  reportMeterValue(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: MeterValueDto,
  ) {
    const operatorPartnerId = resolveOperatorPartner(user);
    return this.sessionsService.reportMeterValue(
      id,
      dto.energyKwh,
      operatorPartnerId ? null : user.id,
      operatorPartnerId ? { partnerId: operatorPartnerId } : undefined,
    );
  }

  @Post('sessions/:id/stop')
  stopSession(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: StopSessionDto,
  ) {
    return this.sessionsService.stop(id, user.id, dto);
  }

  @Get('sessions/me')
  myHistory(@CurrentUser() user: RequestUser) {
    return this.sessionsService.historyForUser(user.id);
  }
}
