import { PrismaClient } from '@prisma/client';
import { EvChargingController } from '../src/modules/ev-charging/ev-charging.controller';
import { createEvConnector, createFastChargeStation, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * "Все станции могли заряжаться только из нашего application исключительно"
 * (Arman, 2026-08-26). TuTak has no start/stop command for a FastCharge
 * charger — see `EvStationProvider`'s own doc comment — so a customer who
 * found one on the nearby list could tap it and go nowhere. The fix is at
 * the source: `nearby` never returns a `FASTCHARGE`-provider station.
 * `GET /ev/stations` (the partner's own inventory/reconciliation view) is
 * deliberately untouched — a partner still needs to see their own FastCharge
 * station for revenue tracking, just not a customer looking for a place to
 * plug in.
 */
describe('EV stations — nearby excludes FastCharge (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: EvChargingController;

  const CENTRE = { lat: 40.1776, lng: 44.5126, radiusKm: 10 };

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(EvChargingController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('never returns a FASTCHARGE-provider station, even when it is the closest one', async () => {
    const partner = await createPartner(prisma);
    await createFastChargeStation(prisma, { partnerId: partner.id });

    const rows = await controller.nearby(CENTRE);

    expect(rows).toEqual([]);
  });

  it('still returns an ordinary INTERNAL station', async () => {
    const partner = await createPartner(prisma);
    const connector = await createEvConnector(prisma, { partnerId: partner.id });
    const internal = await prisma.evStation.findUniqueOrThrow({
      where: { id: connector.stationId },
    });

    const rows = await controller.nearby(CENTRE);

    expect(rows.map((r) => r.id)).toEqual([internal.id]);
  });

  it('returns the INTERNAL station and silently drops the FASTCHARGE one when both are nearby', async () => {
    const partner = await createPartner(prisma);
    const connector = await createEvConnector(prisma, { partnerId: partner.id });
    const internal = await prisma.evStation.findUniqueOrThrow({
      where: { id: connector.stationId },
    });
    await createFastChargeStation(prisma, { partnerId: partner.id });

    const rows = await controller.nearby(CENTRE);

    expect(rows.map((r) => r.id)).toEqual([internal.id]);
  });

  it('still lists a FASTCHARGE station on the unfiltered partner-facing endpoint', async () => {
    const partner = await createPartner(prisma);
    const { station } = await createFastChargeStation(prisma, { partnerId: partner.id });

    const rows = await controller.listStations();

    expect(rows.map((r) => r.id)).toContain(station.id);
  });
});
