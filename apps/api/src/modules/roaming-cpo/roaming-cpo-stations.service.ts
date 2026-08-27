import { Injectable, NotFoundException } from '@nestjs/common';
import { EvStationProvider } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RoamingCpoStationSyncDto } from './dto/roaming-cpo-station-sync.dto';

/**
 * Syncs one roaming-CPO station/location and its connectors into TuTak's own
 * `EvStation`/`EvConnector` tables — "extend, don't build parallel" per the
 * task brief: a multi-location roaming-CPO partner is the same `EvStation`/
 * `EvConnector` model every other EV station already uses, distinguished
 * only by `provider: ROAMING_CPO` and the `external*Id` columns.
 *
 * Idempotent upsert keyed by the partner's own ids, so re-syncing (the
 * partner re-sends its full station list, or corrects one field) never
 * creates duplicates and never touches a station/connector belonging to
 * another partner's `externalStationId`/`externalConnectorId` — the unique
 * index on each backs that, and the upsert is additionally scoped to the
 * calling partner's own rows only.
 */
@Injectable()
export class RoamingCpoStationsService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(partnerId: string, dto: RoamingCpoStationSyncDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.evStation.findUnique({
        where: { externalStationId: dto.externalStationId },
      });
      if (existing && existing.partnerId !== partnerId) {
        // Someone else's external id — never silently reassign a station
        // that belongs to another partner's account.
        throw new Error('externalStationId belongs to a different partner');
      }

      const station = await tx.evStation.upsert({
        where: { externalStationId: dto.externalStationId },
        create: {
          partnerId,
          provider: EvStationProvider.ROAMING_CPO,
          externalStationId: dto.externalStationId,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          latitude: dto.latitude,
          longitude: dto.longitude,
          standardRetailRatePerKwh: dto.standardRetailRatePerKwh,
        },
        update: {
          name: dto.name,
          address: dto.address,
          city: dto.city,
          latitude: dto.latitude,
          longitude: dto.longitude,
          standardRetailRatePerKwh: dto.standardRetailRatePerKwh,
        },
      });

      for (const connector of dto.connectors) {
        const existingConnector = await tx.evConnector.findUnique({
          where: { externalConnectorId: connector.externalConnectorId },
        });
        if (existingConnector && existingConnector.stationId !== station.id) {
          throw new Error('externalConnectorId belongs to a different station');
        }

        await tx.evConnector.upsert({
          where: { externalConnectorId: connector.externalConnectorId },
          create: {
            stationId: station.id,
            externalConnectorId: connector.externalConnectorId,
            connectorType: connector.connectorType,
            powerKw: connector.powerKw,
            // Roaming-CPO connectors never bill at a flat connector price —
            // every session carries its own `appliedCustomerRatePerKwh`
            // (requirement: "never infer or guess a customer's tariff").
            // This column still exists (non-null on the schema) purely
            // because `EvConnector` is shared with `INTERNAL` stations that
            // do bill at it; it is never read for a ROAMING_CPO session.
            pricePerKwh: dto.standardRetailRatePerKwh,
          },
          update: {
            connectorType: connector.connectorType,
            powerKw: connector.powerKw,
            pricePerKwh: dto.standardRetailRatePerKwh,
          },
        });
      }

      return tx.evStation.findUniqueOrThrow({
        where: { id: station.id },
        include: { connectors: true },
      });
    });
  }

  /**
   * Read-only lookup a caller must use to learn *whose* station this is
   * before authorizing a write against it — see
   * `RoamingCpoController.updateStationTariff`, which checks
   * `assertPartnerScope` against this result before calling `updateTariff`.
   * Checking scope only *after* a write (against the row the write just
   * touched) would let the write itself happen first and be visible even if
   * the scope check then throws — same reasoning as
   * `EvChargingController.createConnector`.
   */
  async findStationOrThrow(id: string) {
    const station = await this.prisma.evStation.findUnique({ where: { id } });
    if (!station) throw new NotFoundException('Station not found');
    return station;
  }

  async listForPartner(partnerId: string) {
    return this.prisma.evStation.findMany({
      where: { partnerId, provider: EvStationProvider.ROAMING_CPO },
      include: { connectors: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Admin/partner-facing edit of a station's *display* tariff — requirement:
   * "admins need visibility into station-level tariffs and the ability to
   * see/adjust them (future tariff changes must never touch completed-session
   * data)". This only ever writes `EvStation.standardRetailRatePerKwh`; every
   * completed `EvSession` already carries its own frozen
   * `stationRetailRatePerKwh` snapshot from the moment it settled, so this
   * has no path back to a historical row at all — immutability holds by
   * construction, not by a guard that could be forgotten.
   */
  async updateTariff(stationId: string, standardRetailRatePerKwh: string) {
    return this.prisma.evStation.update({
      where: { id: stationId },
      data: { standardRetailRatePerKwh },
    });
  }
}
