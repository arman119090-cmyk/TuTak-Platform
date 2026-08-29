import { PermissionName, PrismaClient, RoleName } from '@prisma/client';
import { EvChargingController } from '../src/modules/ev-charging/ev-charging.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createEvConnector, createRoamingCpoStation, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * "Все станции могли заряжаться только из нашего application исключительно"
 * (Arman, 2026-08-26). A `ROAMING_CPO` station is excluded from customer
 * discovery until its remote Start/Stop/trusted-CDR path is proven and
 * `customerChargingEnabled` is switched on — see `EvStation`'s own docblock
 * and docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md, Problem 2.
 * `GET /ev/stations` (the partner/admin inventory view) is a *separate*
 * surface, not a customer-facing one — see the "hidden inventory" describe
 * block below for its own authorization contract.
 */
describe('EV stations — nearby excludes non-chargeable stations (integration)', () => {
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

  it('never returns a ROAMING_CPO-provider station that has not been enabled for in-app charging', async () => {
    const partner = await createPartner(prisma);
    await createRoamingCpoStation(prisma, { partnerId: partner.id });

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

  it('returns the INTERNAL station and drops the non-chargeable ROAMING_CPO one when both are nearby', async () => {
    const partner = await createPartner(prisma);
    const connector = await createEvConnector(prisma, { partnerId: partner.id });
    const internal = await prisma.evStation.findUniqueOrThrow({
      where: { id: connector.stationId },
    });
    await createRoamingCpoStation(prisma, { partnerId: partner.id });

    const rows = await controller.nearby(CENTRE);

    expect(rows.map((r) => r.id)).toEqual([internal.id]);
  });

  it('returns a ROAMING_CPO station once it is explicitly enabled for in-app charging', async () => {
    const partner = await createPartner(prisma);
    const { station } = await createRoamingCpoStation(prisma, { partnerId: partner.id });
    await prisma.evStation.update({
      where: { id: station.id },
      data: { customerChargingEnabled: true, remoteStartSupported: true, remoteStopSupported: true },
    });

    const rows = await controller.nearby(CENTRE);

    expect(rows.map((r) => r.id)).toEqual([station.id]);
  });

  it('404s a non-chargeable station on the customer-facing single-station lookup', async () => {
    const partner = await createPartner(prisma);
    const { station } = await createRoamingCpoStation(prisma, { partnerId: partner.id });

    await expect(controller.getStation(station.id)).rejects.toThrow(/not found/i);
  });
});

/**
 * docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md, Problem 2: this
 * endpoint used to have no guard at all, so any authenticated customer could
 * enumerate the full inventory — including hidden `ROAMING_CPO` stations —
 * and feed a connector id straight into `sessions/start`. It is now
 * partner/admin inventory, scoped like every other `EV_STATION_MANAGE` route.
 */
describe('EV stations — hidden-inventory IDOR (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: EvChargingController;

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

  const admin: RequestUser = {
    id: 'admin-user',
    phone: '+37400000001',
    roles: [RoleName.ADMIN],
    permissions: [PermissionName.EV_STATION_MANAGE],
    partnerScopes: {},
    mustChangePassword: false,
  };

  const partnerStaff = (partnerId: string): RequestUser => ({
    id: 'partner-staff-user',
    phone: '+37400000002',
    roles: [RoleName.PARTNER_OWNER],
    permissions: [PermissionName.EV_STATION_MANAGE],
    partnerScopes: { [RoleName.PARTNER_OWNER]: [partnerId] },
    mustChangePassword: false,
  });

  it('a platform admin sees every station across every partner', async () => {
    const partnerA = await createPartner(prisma);
    const partnerB = await createPartner(prisma);
    const { station: stationA } = await createRoamingCpoStation(prisma, { partnerId: partnerA.id });
    const { station: stationB } = await createRoamingCpoStation(prisma, { partnerId: partnerB.id });

    const rows = await controller.listStations(admin);

    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([stationA.id, stationB.id]));
  });

  it('a partner-scoped staff member sees only their own partner’s stations', async () => {
    const partnerA = await createPartner(prisma);
    const partnerB = await createPartner(prisma);
    const { station: stationA } = await createRoamingCpoStation(prisma, { partnerId: partnerA.id });
    await createRoamingCpoStation(prisma, { partnerId: partnerB.id });

    const rows = await controller.listStations(partnerStaff(partnerA.id));

    expect(rows.map((r) => r.id)).toEqual([stationA.id]);
  });

  it('refuses a partner-scoped staff member who names a different partner explicitly', async () => {
    const partnerA = await createPartner(prisma);
    const partnerB = await createPartner(prisma);
    await createRoamingCpoStation(prisma, { partnerId: partnerB.id });

    // `listStations` throws synchronously (it is not `async`), so the
    // rejection form of `expect` never gets a promise to catch — the throw
    // happens while evaluating the argument, before `expect` runs at all.
    expect(() => controller.listStations(partnerStaff(partnerA.id), partnerB.id)).toThrow(
      /not authorized/i,
    );
  });
});
