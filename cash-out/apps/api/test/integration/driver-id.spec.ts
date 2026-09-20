import { Money } from '@cashout/money';
import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
} from '../harness';

/**
 * Driver ID changes: verified against the fleet, pending until approved,
 * never active on the driver's word alone.
 */
describe('Driver ID change requests', () => {
  let harness: Harness;
  let driver: SeededDriver;
  const ADMIN = '00000000-0000-0000-0000-000000000001';

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
    driver = await seedDriver(harness, { balance: 5_000_000n });
  });

  function seedProfile(id: string, phone: string) {
    harness.yandex.seed({
      parkId: driver.yandexParkId,
      contractorProfileId: id,
      phone,
      firstName: 'Ara',
      lastName: 'Sargsyan',
      licenceNumber: 'AM0000000',
      balance: Money.fromMinor(1_000_000n, 'AMD'),
    });
  }

  it('shows the current Driver ID and an empty history', async () => {
    const state = await harness.driverIds.state(driver.driverId);
    expect(state.current).toEqual({
      driverId: driver.contractorProfileId,
      park: { id: driver.parkId, name: expect.any(String) },
    });
    expect(state.pending).toBeNull();
    expect(state.history).toEqual([]);
  });

  it('approves at once when the fleet knows the profile under the driver’s own phone', async () => {
    seedProfile('c-new-self', driver.phone);
    const result = await harness.driverIds.request(driver.driverId, 'c-new-self');
    expect(result.status).toBe('APPROVED');
    expect(result.verificationNote).toBe('phone_matched');
    expect(result.verifiedAt).not.toBeNull();

    const profile = await harness.drivers.profile(driver.userId);
    expect(profile.driverId).toBe('c-new-self');
    const audit = await harness.prisma.auditLog.findMany({
      where: { action: { in: ['driver_id.requested', 'driver_id.changed'] } },
    });
    expect(audit.map((row) => row.action).sort()).toEqual([
      'driver_id.changed',
      'driver_id.requested',
    ]);
    // Nothing cached for the old profile survives.
    expect(
      await harness.prisma.balanceSnapshot.count({ where: { driverId: driver.driverId } }),
    ).toBe(0);
  });

  it('leaves the request pending when the profile carries another phone, and an operator approves it', async () => {
    seedProfile('c-other-phone', '+37499000000');
    const result = await harness.driverIds.request(driver.driverId, 'c-other-phone');
    expect(result.status).toBe('PENDING');
    expect(result.verificationNote).toBe('phone_mismatch');
    expect((await harness.drivers.profile(driver.userId)).driverId).toBe(
      driver.contractorProfileId,
    );

    const listed = await harness.driverIds.listForAdmin({ status: 'PENDING', limit: 10 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.phone).toBe(driver.phone);

    await harness.driverIds.approve(result.id, ADMIN, 'park confirmed by phone call');
    const state = await harness.driverIds.state(driver.driverId);
    expect(state.current?.driverId).toBe('c-other-phone');
    expect(state.pending).toBeNull();
    expect(state.history[0]).toMatchObject({
      status: 'APPROVED',
      decisionReason: 'park confirmed by phone call',
    });
  });

  it('is rejected by an operator with a reason, and the id stays as it was', async () => {
    const result = await harness.driverIds.request(driver.driverId, 'c-unknown');
    expect(result.status).toBe('PENDING');
    expect(result.verificationNote).toBe('profile_not_found');

    await harness.driverIds.reject(result.id, ADMIN, 'no such profile in the park');
    const state = await harness.driverIds.state(driver.driverId);
    expect(state.current?.driverId).toBe(driver.contractorProfileId);
    expect(state.history[0]).toMatchObject({ status: 'REJECTED' });
    expect(await harness.prisma.auditLog.count({ where: { action: 'driver_id.rejected' } })).toBe(
      1,
    );

    await expect(
      harness.driverIds.approve(result.id, ADMIN, 'changed my mind'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('waits when the fleet does not answer, rather than guessing', async () => {
    harness.yandex.behaviour = { mode: 'unavailable' };
    const result = await harness.driverIds.request(driver.driverId, 'c-later');
    expect(result.status).toBe('PENDING');
    expect(result.verificationNote).toBe('yandex_unavailable');
  });

  it('refuses unauthorized or impossible changes', async () => {
    await expect(
      harness.driverIds.request(driver.driverId, driver.contractorProfileId),
    ).rejects.toMatchObject({
      code: 'DRIVER_ID_INVALID',
    });

    const other = await seedDriver(harness, {
      phone: '+37411000002',
      contractorProfileId: 'c-taken',
    });
    await expect(harness.driverIds.request(driver.driverId, 'c-taken')).rejects.toMatchObject({
      code: 'DRIVER_ID_INVALID',
    });

    const pending = await harness.driverIds.request(driver.driverId, 'c-first');
    await expect(harness.driverIds.request(driver.driverId, 'c-second')).rejects.toMatchObject({
      code: 'DRIVER_ID_CHANGE_PENDING',
    });

    // Another driver cannot cancel it.
    await expect(harness.driverIds.cancel(other.driverId, pending.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await harness.driverIds.cancel(driver.driverId, pending.id);
    expect((await harness.driverIds.state(driver.driverId)).history[0]?.status).toBe('CANCELLED');
  });

  it('does not apply a change while a payout is running against the old id', async () => {
    await requestWithdrawal(harness, driver, 1_000_000n);
    seedProfile('c-mid-payout', driver.phone);
    const result = await harness.driverIds.request(driver.driverId, 'c-mid-payout');
    expect(result.status).toBe('PENDING');
    expect(result.verificationNote).toContain('withdrawal_in_progress');
    await expect(harness.driverIds.approve(result.id, ADMIN, 'ok')).rejects.toMatchObject({
      code: 'WITHDRAWAL_ALREADY_IN_PROGRESS',
    });
  });
});
