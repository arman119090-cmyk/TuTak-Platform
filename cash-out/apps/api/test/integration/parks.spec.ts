import { Money } from '@cashout/money';
import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  seedMembership,
  seedPark,
  seedPricing,
} from '../harness';

/**
 * Parks, rosters and the active park.
 *
 * After the OTP the phone is looked up in Cash Out's own roster. What follows
 * from that lookup — nothing, one park, or a choice — is decided here, and so
 * is what happens to the balance when the driver moves between parks.
 */
describe('parks and memberships', () => {
  let harness: Harness;
  const phone = '+37411777100';

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.rateLimiter.resetAll();
    harness.yandex.reset();
    harness.provider.reset();
    await seedPricing(harness.prisma);
  });

  async function signUp(withPhone = phone) {
    const user = await harness.prisma.user.create({
      data: { phone: withPhone, locale: 'hy', driver: { create: {} } },
    });
    const driver = await harness.prisma.driver.findUniqueOrThrow({ where: { userId: user.id } });
    return { userId: user.id, driverId: driver.id };
  }

  describe('login resolution', () => {
    it('reports DRIVER_NOT_FOUND semantics when the phone is in no roster', async () => {
      const { userId } = await signUp();
      const profile = await harness.drivers.profile(userId);

      expect(profile.resolution).toBe('NONE');
      expect(profile.membershipCount).toBe(0);
      expect(profile.activePark).toBeNull();
      expect(profile.verificationStatus).toBe('UNLINKED');

      const driver = await harness.prisma.driver.findUniqueOrThrow({ where: { userId } });
      await expect(harness.balances.forDisplay(driver.id)).rejects.toMatchObject({
        code: 'PARK_NOT_SELECTED',
      });
    });

    it('selects the park automatically when the phone is in exactly one roster', async () => {
      const park = await seedPark(harness, { yandexParkId: 'park-solo', name: 'Solo Park' });
      await seedMembership(harness, park, { phone, contractorProfileId: 'c-solo' });

      const { userId } = await signUp();
      const profile = await harness.drivers.profile(userId);

      expect(profile.resolution).toBe('ACTIVE');
      expect(profile.activePark?.name).toBe('Solo Park');
      expect(profile.driverId).toBe('c-solo');
      expect(profile.verificationStatus).toBe('VERIFIED');

      const switches = await harness.prisma.parkSwitch.findMany();
      expect(switches).toHaveLength(1);
      expect(switches[0]?.actorType).toBe('AUTO');
    });

    it('asks the driver to choose when the phone is in several rosters', async () => {
      const a = await seedPark(harness, { yandexParkId: 'park-a', name: 'Park A' });
      const b = await seedPark(harness, { yandexParkId: 'park-b', name: 'Park B' });
      await seedMembership(harness, a, { phone, contractorProfileId: 'c-a' });
      await seedMembership(harness, b, { phone, contractorProfileId: 'c-b' });

      const { userId, driverId } = await signUp();
      const profile = await harness.drivers.profile(userId);

      expect(profile.resolution).toBe('CHOOSE');
      expect(profile.activePark).toBeNull();
      expect(profile.membershipCount).toBe(2);

      const list = await harness.memberships.list(driverId);
      expect(list.map((row) => row.park.name).sort()).toEqual(['Park A', 'Park B']);
      expect(list.every((row) => row.available && !row.isActive)).toBe(true);
    });

    it('does not count an ineligible or suspended membership as a choice', async () => {
      const a = await seedPark(harness, { yandexParkId: 'park-a' });
      const b = await seedPark(harness, { yandexParkId: 'park-b', status: 'SUSPENDED' });
      await seedMembership(harness, a, { phone, contractorProfileId: 'c-a' });
      await seedMembership(harness, b, { phone, contractorProfileId: 'c-b' });

      const { userId } = await signUp();
      const profile = await harness.drivers.profile(userId);

      // Only one usable park: chosen automatically.
      expect(profile.resolution).toBe('ACTIVE');
      expect(profile.activePark?.id).toBe(a.id);
    });

    it('picks up a roster row imported after the driver signed in', async () => {
      const { userId } = await signUp();
      expect((await harness.drivers.profile(userId)).resolution).toBe('NONE');

      const park = await seedPark(harness, { yandexParkId: 'park-late' });
      await seedMembership(harness, park, { phone, contractorProfileId: 'c-late' });

      expect((await harness.drivers.profile(userId)).resolution).toBe('ACTIVE');
    });
  });

  describe('choosing and switching parks', () => {
    it('activates a chosen park, verifies eligibility, and records the switch', async () => {
      const a = await seedPark(harness, { yandexParkId: 'park-a' });
      const b = await seedPark(harness, { yandexParkId: 'park-b' });
      await seedMembership(harness, a, { phone, contractorProfileId: 'c-a' });
      await seedMembership(harness, b, { phone, contractorProfileId: 'c-b' });
      const { userId, driverId } = await signUp();
      await harness.drivers.profile(userId);

      await harness.memberships.activate(driverId, b.id, 'DRIVER', userId);
      const profile = await harness.drivers.profile(userId);
      expect(profile.activePark?.id).toBe(b.id);
      expect(profile.driverId).toBe('c-b');

      const audit = await harness.prisma.auditLog.findMany({
        where: { action: 'driver.park_switched' },
      });
      expect(audit).toHaveLength(1);
    });

    it('denies a park the driver is not a member of, and changes nothing', async () => {
      const a = await seedPark(harness, { yandexParkId: 'park-a' });
      const other = await seedPark(harness, { yandexParkId: 'park-other' });
      await seedMembership(harness, a, { phone, contractorProfileId: 'c-a' });
      const { userId, driverId } = await signUp();
      await harness.drivers.profile(userId);

      await expect(
        harness.memberships.activate(driverId, other.id, 'DRIVER', userId),
      ).rejects.toMatchObject({ code: 'PARK_ACCESS_DENIED' });
      expect((await harness.drivers.profile(userId)).activePark?.id).toBe(a.id);
    });

    it('denies an ineligible membership with the reason', async () => {
      const a = await seedPark(harness, { yandexParkId: 'park-a' });
      const b = await seedPark(harness, { yandexParkId: 'park-b' });
      await seedMembership(harness, a, { phone, contractorProfileId: 'c-a' });
      await seedMembership(harness, b, {
        phone,
        contractorProfileId: 'c-b',
        eligibility: 'INELIGIBLE',
      });
      const { userId, driverId } = await signUp();
      await harness.drivers.profile(userId);

      await expect(
        harness.memberships.activate(driverId, b.id, 'DRIVER', userId),
      ).rejects.toMatchObject({
        code: 'PARK_ACCESS_DENIED',
        details: { reason: 'eligibility_ineligible' },
      });
    });

    it('throws away the old park’s balance and requires a fresh one for the new park', async () => {
      const a = await seedPark(harness, { yandexParkId: 'park-a' });
      const b = await seedPark(harness, { yandexParkId: 'park-b' });
      await seedMembership(harness, a, { phone, contractorProfileId: 'c-a', balance: 9_000_000n });
      await seedMembership(harness, b, { phone, contractorProfileId: 'c-b', balance: 1_000_000n });
      const { userId, driverId } = await signUp();
      await harness.drivers.profile(userId);
      await harness.memberships.activate(driverId, a.id, 'DRIVER', userId);

      const before = await harness.balances.forDisplay(driverId);
      expect(before.available.minor).toBe(9_000_000n);
      expect(await harness.prisma.balanceSnapshot.count({ where: { driverId } })).toBe(1);

      await harness.memberships.activate(driverId, b.id, 'DRIVER', userId);
      expect(await harness.prisma.balanceSnapshot.count({ where: { driverId } })).toBe(0);

      // Yandex down for the new park: no cached figure from park A may leak.
      harness.yandex.behaviour = { mode: 'unavailable' };
      await expect(harness.balances.forDisplay(driverId)).rejects.toMatchObject({
        code: 'BALANCE_UNAVAILABLE',
      });
      await expect(harness.balances.requireFresh(driverId)).rejects.toMatchObject({
        code: 'YANDEX_UNAVAILABLE',
      });

      harness.yandex.behaviour = { mode: 'normal' };
      const after = await harness.balances.forDisplay(driverId);
      expect(after.available.minor).toBe(1_000_000n);
      expect(after.park.id).toBe(b.id);
    });

    it('refuses to switch while a payout is in progress', async () => {
      const driver = await seedDriver(harness, { phone });
      const b = await seedPark(harness, { yandexParkId: 'park-b' });
      await seedMembership(harness, b, { phone, contractorProfileId: 'c-b' });
      await harness.drivers.profile(driver.userId); // attaches the new row
      await requestWithdrawal(harness, driver, 1_000_000n);

      await expect(
        harness.memberships.activate(driver.driverId, b.id, 'DRIVER', driver.userId),
      ).rejects.toMatchObject({ code: 'WITHDRAWAL_ALREADY_IN_PROGRESS' });
    });

    it('drops the active park when an operator suspends the membership', async () => {
      const driver = await seedDriver(harness, { phone });
      const membership = await harness.prisma.driverParkMembership.findFirstOrThrow({
        where: { driverId: driver.driverId },
      });
      await harness.parksAdmin.updateMembership(
        membership.id,
        { eligibility: 'INELIGIBLE', reason: 'park asked us to' },
        '00000000-0000-0000-0000-000000000001',
      );
      const profile = await harness.drivers.profile(driver.userId);
      expect(profile.resolution).toBe('NONE');
      expect(profile.membershipCount).toBe(1);
      await expect(harness.balances.forDisplay(driver.driverId)).rejects.toMatchObject({
        code: 'PARK_NOT_SELECTED',
      });
    });
  });

  describe('withdrawals are scoped to the active park', () => {
    it('records the park and its Yandex id on the withdrawal and debits that park', async () => {
      const driver = await seedDriver(harness, { phone, parkId: 'park-x' });
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.parkId).toBe(driver.parkId);
      expect(row.yandexParkId).toBe('park-x');
      expect(row.yandexContractorProfileId).toBe(driver.contractorProfileId);
    });
  });

  describe('the roster', () => {
    it('imports rows, normalises phones, attaches signed-in drivers and refuses to move a claimed profile', async () => {
      const park = await seedPark(harness, { yandexParkId: 'park-r' });
      const { userId, driverId } = await signUp('+37494000001');
      const adminId = '00000000-0000-0000-0000-000000000001';

      const first = await harness.parksAdmin.importRoster(
        park.id,
        {
          rows: [
            { phone: '094 00 00 01', externalProfileId: 'c-1', firstName: 'Ara' },
            { phone: '+37494000002', externalProfileId: 'c-2' },
            { phone: 'not a phone', externalProfileId: 'c-3' },
          ],
        },
        adminId,
      );
      expect(first).toMatchObject({ created: 2, updated: 0, skipped: 1 });
      expect(first.errors[0]?.reason).toContain('unparseable');

      // The signed-in driver was attached to their row at import time.
      const attached = await harness.prisma.driverParkMembership.findUniqueOrThrow({
        where: { parkId_externalProfileId: { parkId: park.id, externalProfileId: 'c-1' } },
      });
      expect(attached.driverId).toBe(driverId);
      expect(attached.phone).toBe('+37494000001');
      expect((await harness.drivers.profile(userId)).resolution).toBe('ACTIVE');

      // A second import: an update, and an attempt to hand c-1 to another phone.
      const second = await harness.parksAdmin.importRoster(
        park.id,
        {
          rows: [
            { phone: '+37494000002', externalProfileId: 'c-2', lastName: 'Two' },
            { phone: '+37494000009', externalProfileId: 'c-1' },
          ],
        },
        adminId,
      );
      expect(second).toMatchObject({ created: 0, updated: 1, skipped: 1 });
      expect(second.errors[0]?.reason).toContain('claimed');

      const imports = await harness.prisma.rosterImport.findMany({ where: { parkId: park.id } });
      expect(imports).toHaveLength(2);
    });

    it('synchronises the roster from the (mock) Fleet API', async () => {
      const park = await seedPark(harness, { yandexParkId: 'park-sync' });
      for (const n of [1, 2, 3]) {
        harness.yandex.seed({
          parkId: 'park-sync',
          contractorProfileId: `sync-${n}`,
          phone: `+3749400010${n}`,
          firstName: 'Sync',
          lastName: String(n),
          licenceNumber: 'AM0000000',
          balance: Money.fromMinor(0n, 'AMD'),
        });
      }
      const result = await harness.parksAdmin.syncFromYandex(park.id, null);
      expect(result).toMatchObject({ total: 3, created: 3 });

      const rows = await harness.prisma.driverParkMembership.findMany({
        where: { parkId: park.id },
      });
      expect(rows.every((row) => row.source === 'YANDEX_SYNC' && row.lastSyncedAt)).toBe(true);

      harness.yandex.behaviour = { mode: 'unavailable' };
      await expect(harness.parksAdmin.syncFromYandex(park.id, null)).rejects.toMatchObject({
        code: 'YANDEX_UNAVAILABLE',
      });
    });

    it('stores a park credential encrypted and never returns it', async () => {
      const park = await seedPark(harness, { yandexParkId: 'park-cred' });
      const adminId = '00000000-0000-0000-0000-000000000001';
      await harness.parksAdmin.setCredential(
        park.id,
        { clientId: 'taxi/park/abc', apiKey: 'super-secret-api-key-value' },
        adminId,
      );
      const row = await harness.prisma.parkIntegrationCredential.findUniqueOrThrow({
        where: { parkId: park.id },
      });
      expect(row.apiKeyEnc).not.toContain('super-secret');
      expect(row.apiKeyHint).toBe('alue');

      const detail = await harness.parksAdmin.detail(park.id);
      expect(JSON.stringify(detail)).not.toContain('super-secret');
      expect(detail.credential?.apiKeyHint).toBe('alue');
    });
  });
});
