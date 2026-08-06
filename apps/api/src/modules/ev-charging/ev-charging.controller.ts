import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { PermissionName } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
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

  @Post('stations')
  @RequirePermissions(PermissionName.EV_STATION_MANAGE)
  createStation(@Body() dto: CreateStationDto) {
    return this.stationsService.createStation(dto);
  }

  @Post('connectors')
  @RequirePermissions(PermissionName.EV_STATION_MANAGE)
  createConnector(@Body() dto: CreateConnectorDto) {
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

  @Post('sessions/:id/meter-value')
  reportMeterValue(@Param('id') id: string, @Body() dto: MeterValueDto) {
    return this.sessionsService.reportMeterValue(id, dto.energyKwh);
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
