import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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

  /** Simple bounding-box "nearby" search — swap for PostGIS ST_DWithin at scale. */
  async listNearby(lat: number, lng: number, radiusKm = 10) {
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    return this.prisma.evStation.findMany({
      where: {
        latitude: { gte: lat - latDelta, lte: lat + latDelta },
        longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
      },
      include: { connectors: true },
    });
  }

  listAll() {
    return this.prisma.evStation.findMany({ include: { connectors: true } });
  }
}
