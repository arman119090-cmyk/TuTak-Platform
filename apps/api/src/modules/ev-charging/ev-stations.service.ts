import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { haversineKm } from '../../common/utils/geo';
import { CreateConnectorDto } from './dto/create-connector.dto';
import { CreateStationDto } from './dto/create-station.dto';

@Injectable()
export class EvStationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `CreateStationDto` has no `provider` field — this is the only path that
   * creates a station outside `RoamingCpoStationsService.sync`, so every
   * station it creates is `INTERNAL` (the schema default). TuTak's own
   * hardware has never needed a remote adapter to be chargeable, so this is
   * where that station's capability flags are explicitly turned on — the
   * schema's own column default is `false` (safe for a synced `ROAMING_CPO`
   * station, wrong for this one), so leaving it unset here would make every
   * newly created internal station invisible to `listNearby` and unstartable.
   */
  createStation(dto: CreateStationDto) {
    return this.prisma.evStation.create({
      data: {
        ...dto,
        customerChargingEnabled: true,
        remoteStartSupported: true,
        remoteStopSupported: true,
        trustedTelemetrySupported: true,
      },
    });
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
   * The customer-facing single-station lookup (EV-02 station details) —
   * distinct from `findStationOrThrow`, which every authorized management
   * caller (partner/admin) still uses to look up a station regardless of
   * whether it is customer-chargeable. Returning 404 for a station that
   * exists but is not `customerChargingEnabled` is deliberate: it must not
   * be distinguishable from a station that doesn't exist at all, or the
   * hidden-inventory hole this closes (docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md,
   * Problem 2) reopens as an existence oracle instead.
   */
  async findChargeableStationOrThrow(id: string) {
    const station = await this.prisma.evStation.findUnique({
      where: { id },
      include: { connectors: true, partner: { select: { id: true, displayName: true } } },
    });
    if (!station || !station.customerChargingEnabled) {
      throw new NotFoundException('Charging station not found');
    }
    return station;
  }

  /**
   * Simple bounding-box "nearby" search — swap for PostGIS ST_DWithin at
   * scale. The box only narrows what the database scans; `distanceKm` below
   * is the real, round-earth distance, computed the same way
   * `PartnersService.listNearby` computes it for partner branches, so a
   * merged map/list of stations and partners can sort the two together by
   * one consistent number.
   *
   * Filtered by `customerChargingEnabled`, not by `provider` — see that
   * column's docblock. A `ROAMING_CPO` station is included exactly when its
   * remote Start/Stop/trusted-CDR path has been proven and switched on; an
   * `INTERNAL` station always qualifies. Arman, 2026-08-26: "все станции
   * могли заряжаться только из нашего application исключительно" — every
   * discoverable station must be genuinely chargeable through this app, not
   * excluded-by-brand.
   */
  async listNearby(lat: number, lng: number, radiusKm = 10) {
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const stations = await this.prisma.evStation.findMany({
      where: {
        latitude: { gte: lat - latDelta, lte: lat + latDelta },
        longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
        customerChargingEnabled: true,
      },
      include: { connectors: true },
    });

    return stations
      .map((s) => ({ ...s, distanceKm: haversineKm(lat, lng, s.latitude, s.longitude) }))
      .filter((s) => s.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /**
   * The full inventory, every provider and capability state included —
   * partner/admin only (`EV_STATION_MANAGE`, scoped by `assertPartnerScope`
   * in the controller). Never reachable by an ordinary customer — see
   * `findChargeableStationOrThrow`/`listNearby` for that surface.
   */
  listAll(partnerId?: string) {
    return this.prisma.evStation.findMany({
      where: partnerId ? { partnerId } : undefined,
      include: { connectors: true },
    });
  }
}
