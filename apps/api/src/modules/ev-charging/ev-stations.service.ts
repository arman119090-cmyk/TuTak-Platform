import { EvStationProvider } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { haversineKm } from '../../common/utils/geo';
import { CreateConnectorDto } from './dto/create-connector.dto';
import { CreateStationDto } from './dto/create-station.dto';

@Injectable()
export class EvStationsService {
  constructor(private readonly prisma: PrismaService) {}

  createStation(dto: CreateStationDto) {
    return this.prisma.evStation.create({ data: dto });
  }

  createConnector(dto: CreateConnectorDto) {
    return this.prisma.evConnector.create({ data: dto });
  }

  async findStationOrThrow(id: string) {
    const station = await this.prisma.evStation.findUnique({
      where: { id },
      include: { connectors: true, partner: { select: { id: true, displayName: true } } },
    });
    if (!station) throw new NotFoundException('Charging station not found');
    return station;
  }

  async findConnectorOrThrow(id: string) {
    const connector = await this.prisma.evConnector.findUnique({
      where: { id },
      include: { station: true },
    });
    if (!connector) throw new NotFoundException('Connector not found');
    return connector;
  }

  /**
   * Simple bounding-box "nearby" search — swap for PostGIS ST_DWithin at
   * scale. The box only narrows what the database scans; `distanceKm` below
   * is the real, round-earth distance, computed the same way
   * `PartnersService.listNearby` computes it for partner branches, so a
   * merged map/list of stations and partners can sort the two together by
   * one consistent number.
   *
   * `ROAMING_CPO`-provider stations are excluded (Arman, 2026-08-26: "все
   * станции могли заряжаться только из нашего application исключительно" —
   * every station must be chargeable only from our app). TuTak has no
   * start/stop command for a roaming-CPO charger — see `EvStationProvider`'s
   * own doc comment — so a customer who found one here could never actually
   * charge through this app; `listAll` (the partner-facing inventory/
   * reconciliation view) is unaffected.
   */
  async listNearby(lat: number, lng: number, radiusKm = 10) {
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const stations = await this.prisma.evStation.findMany({
      where: {
        latitude: { gte: lat - latDelta, lte: lat + latDelta },
        longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
        provider: EvStationProvider.INTERNAL,
      },
      include: { connectors: true },
    });

    return stations
      .map((s) => ({ ...s, distanceKm: haversineKm(lat, lng, s.latitude, s.longitude) }))
      .filter((s) => s.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  listAll() {
    return this.prisma.evStation.findMany({ include: { connectors: true } });
  }
}
