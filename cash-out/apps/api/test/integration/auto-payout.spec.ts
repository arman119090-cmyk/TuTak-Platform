import { Money } from '@cashout/money';
import {
  createHarness,
  Harness,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
  TEST_PIN,
} from '../harness';

/**
 * Automatic payouts use the same pipeline as manual ones. These tests prove
 * that: the withdrawal a rule creates is an ordinary withdrawal, subject to the
 * same checks, and the rule stops itself when anything it depends on goes.
 */
describe('automatic payout', () => {
  let harness: Harness;
  let driver: SeededDriver;

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
    await harness.idram.link(driver.driverId, { accountId: '094123456' });
  });

  async function consent(): Promise<string> {
    const result = await harness.security.authorize(
      driver.driverId,
      { userId: driver.userId, deviceId: driver.deviceId },
      { method: 'PIN', pin: TEST_PIN, purpose: 'AUTO_PAYOUT' },
    );
    return result.authorizationToken;
  }

  async function enable(thresholdMinor = 2_000_000n, maxPayoutMinor?: bigint) {
    return harness.autoPayout.upsert(driver.driverId, {
      cadence: 'ON_THRESHOLD',
      threshold: { minor: thresholdMinor.toString(), currency: 'AMD' },
      ...(maxPayoutMinor
        ? { maxPayout: { minor: maxPayoutMinor.toString(), currency: 'AMD' } }
        : {}),
      authorizationToken: await consent(),
    });
  }

  describe('enabling and disabling', () => {
    it('requires the driver’s authorization, records how they consented, and is off by default', async () => {
      expect((await harness.autoPayout.state(driver.driverId)).rule).toBeNull();

      await expect(
        harness.autoPayout.upsert(driver.driverId, {
          cadence: 'ON_THRESHOLD',
          threshold: { minor: '2000000', currency: 'AMD' },
          authorizationToken: 'no-such-authorization-token-0',
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' });

      const rule = await enable();
      expect(rule.enabled).toBe(true);
      expect(rule.authorizationMethod).toBe('PIN');
      expect(rule.destination.maskedIdentifier).toBe('•••• 3456');
      expect(rule.park.id).toBe(driver.parkId);

      const audit = await harness.prisma.auditLog.findMany({
        where: { action: 'auto_payout.enabled' },
      });
      expect(audit).toHaveLength(1);
    });

    it('refuses a WITHDRAWAL authorization as consent for the rule', async () => {
      const wrongPurpose = await harness.security.authorize(
        driver.driverId,
        { userId: driver.userId, deviceId: driver.deviceId },
        { method: 'PIN', pin: TEST_PIN, purpose: 'WITHDRAWAL' },
      );
      await expect(
        harness.autoPayout.upsert(driver.driverId, {
          cadence: 'ON_THRESHOLD',
          threshold: { minor: '2000000', currency: 'AMD' },
          authorizationToken: wrongPurpose.authorizationToken,
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' });
    });

    it('takes its bounds from the park’s limit policy, not from the client', async () => {
      const { constraints } = await harness.autoPayout.state(driver.driverId);
      expect(constraints.minThreshold).toEqual({ minor: '100000', currency: 'AMD' });
      expect(constraints.maxPayout).toEqual({ minor: '30000000', currency: 'AMD' });

      await expect(enable(50_000n)).rejects.toMatchObject({ code: 'AUTO_PAYOUT_INVALID' });
      await expect(enable(2_000_000n, 40_000_000n)).rejects.toMatchObject({
        code: 'AUTO_PAYOUT_INVALID',
      });
    });

    it('needs a verified iDram destination', async () => {
      await harness.idram.unlink(driver.driverId);
      await expect(enable()).rejects.toMatchObject({ code: 'IDRAM_ACCOUNT_NOT_LINKED' });
    });

    it('disables without any authorization and reports the state', async () => {
      await enable();
      await harness.autoPayout.disable(driver.driverId);
      const { rule } = await harness.autoPayout.state(driver.driverId);
      expect(rule?.enabled).toBe(false);
      expect(rule?.nextCheckAt).toBeNull();
      expect(await harness.autoPayout.evaluateDue()).toBe(0);
    });

    it('lists rules for operators with the driver, filtered by state', async () => {
      await enable();
      const all = await harness.autoPayout.listForAdmin({ limit: 10 });
      expect(all.items).toHaveLength(1);
      expect(all.items[0]).toMatchObject({
        driverId: driver.driverId,
        driverPhone: driver.phone,
        enabled: true,
        paused: false,
      });
      expect(all.nextCursor).toBeNull();

      expect(
        (await harness.autoPayout.listForAdmin({ limit: 10, status: 'active' })).items,
      ).toHaveLength(1);
      expect(
        (await harness.autoPayout.listForAdmin({ limit: 10, status: 'paused' })).items,
      ).toHaveLength(0);

      await harness.autoPayout.disable(driver.driverId);
      expect(
        (await harness.autoPayout.listForAdmin({ limit: 10, status: 'active' })).items,
      ).toHaveLength(0);
      expect(
        (await harness.autoPayout.listForAdmin({ limit: 10, status: 'disabled' })).items,
      ).toHaveLength(1);
    });
  });

  describe('evaluation', () => {
    it('does nothing below the threshold and reschedules', async () => {
      const rule = await enable(6_000_000n);
      const result = await harness.autoPayout.evaluate(rule.id);
      expect(result).toEqual({ outcome: 'BELOW_THRESHOLD' });
      expect(await harness.prisma.withdrawal.count()).toBe(0);

      const row = await harness.prisma.autoPayoutRule.findUniqueOrThrow({ where: { id: rule.id } });
      expect(row.nextCheckAt.getTime()).toBe(harness.clock.nowMs() + 900_000);
      expect(row.lastCheckedAt).not.toBeNull();
    });

    it('creates an ordinary withdrawal through the same pipeline when the balance is enough', async () => {
      const rule = await enable(2_000_000n, 3_000_000n);
      const result = await harness.autoPayout.evaluate(rule.id);
      expect(result.outcome).toBe('CREATED');
      if (result.outcome !== 'CREATED') return;

      const row = await harness.prisma.withdrawal.findUniqueOrThrow({
        where: { id: result.withdrawalId },
      });
      expect(row.origin).toBe('AUTO_PAYOUT');
      expect(row.autoPayoutRuleId).toBe(rule.id);
      expect(row.grossMinor).toBe(3_000_000n); // capped by maxPayout
      expect(row.state).toBe('CREATED');

      // Same state machine, same ledger, same outcome as a manual withdrawal.
      for (let i = 0; i < 6; i += 1) {
        await harness.prisma.withdrawal.updateMany({
          where: { id: row.id },
          data: { nextAttemptAt: null },
        });
        await harness.orchestrator.advance(row.id);
      }
      const done = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: row.id } });
      expect(done.state).toBe('COMPLETED');
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        2_000_000n,
      );
      for (const line of await harness.ledger.trialBalance()) {
        expect(line.difference).toBe(0n);
      }

      const state = await harness.autoPayout.state(driver.driverId);
      expect(state.rule?.lastWithdrawalId).toBe(row.id);
      expect(state.rule?.lastRunAt).not.toBeNull();
    });

    it('never pays the same slot twice, and waits while a payout is in progress', async () => {
      const rule = await enable(2_000_000n);
      const first = await harness.autoPayout.evaluate(rule.id);
      expect(first.outcome).toBe('CREATED');

      // The withdrawal is still running: a second evaluation is a no-op.
      await harness.prisma.autoPayoutRule.update({
        where: { id: rule.id },
        data: { nextCheckAt: harness.clock.now() },
      });
      const second = await harness.autoPayout.evaluate(rule.id);
      expect(second).toEqual({ outcome: 'SKIPPED', reason: 'withdrawal_in_progress' });
      expect(await harness.prisma.withdrawal.count()).toBe(1);

      // Replaying the exact slot after a crash is answered by idempotency.
      await harness.prisma.withdrawal.updateMany({ data: { state: 'COMPLETED' } });
      const slot = (
        await harness.prisma.autoPayoutRule.findUniqueOrThrow({ where: { id: rule.id } })
      ).nextCheckAt;
      const key = (await harness.prisma.withdrawal.findFirstOrThrow()).idempotencyKey;
      expect(key.startsWith('auto-')).toBe(true);
      expect(slot).toBeInstanceOf(Date);
    });

    it('is picked up by the worker only when due', async () => {
      await enable(2_000_000n);
      expect(await harness.autoPayout.evaluateDue()).toBe(1);
      expect(await harness.prisma.withdrawal.count()).toBe(1);
      expect(await harness.autoPayout.evaluateDue()).toBe(0);
    });

    it('counts failures and pauses itself after three, saying why', async () => {
      const rule = await enable(2_000_000n);
      harness.yandex.behaviour = { mode: 'unavailable' };

      for (let i = 1; i <= 3; i += 1) {
        await harness.prisma.autoPayoutRule.update({
          where: { id: rule.id },
          data: { nextCheckAt: harness.clock.now() },
        });
        const result = await harness.autoPayout.evaluate(rule.id);
        expect(result).toMatchObject({
          outcome: 'FAILED',
          code: 'YANDEX_UNAVAILABLE',
          paused: i === 3,
        });
      }
      const state = await harness.autoPayout.state(driver.driverId);
      expect(state.rule?.paused).toBe(true);
      expect(state.rule?.pausedReason).toBe('repeated_failures:YANDEX_UNAVAILABLE');
      expect(state.rule?.consecutiveFailures).toBe(3);
      expect(await harness.prisma.withdrawal.count()).toBe(0);

      const audit = await harness.prisma.auditLog.findMany({
        where: { action: { in: ['auto_payout.failed', 'auto_payout.paused'] } },
        orderBy: { at: 'asc' },
      });
      expect(audit.map((row) => row.action)).toEqual([
        'auto_payout.failed',
        'auto_payout.failed',
        'auto_payout.paused',
      ]);
    });

    it('pauses when the destination or the park stops being usable', async () => {
      const rule = await enable(2_000_000n);
      await harness.idram.unlink(driver.driverId);
      expect(await harness.autoPayout.evaluate(rule.id)).toMatchObject({
        outcome: 'PAUSED',
        reason: 'PAYOUT_METHOD_NOT_FOUND',
      });

      // Re-enable with a fresh destination, then take the park away.
      await harness.idram.link(driver.driverId, { accountId: '094123456' });
      const again = await enable(2_000_000n);
      const membership = await harness.prisma.driverParkMembership.findFirstOrThrow({
        where: { driverId: driver.driverId },
      });
      await harness.parksAdmin.updateMembership(
        membership.id,
        { eligibility: 'INELIGIBLE', reason: 'test' },
        '00000000-0000-0000-0000-000000000001',
      );
      expect(await harness.autoPayout.evaluate(again.id)).toMatchObject({
        outcome: 'PAUSED',
        reason: 'PARK_NOT_SELECTED',
      });
    });

    it('a re-enabled rule starts clean', async () => {
      const rule = await enable(2_000_000n);
      harness.yandex.behaviour = { mode: 'unavailable' };
      await harness.autoPayout.evaluate(rule.id);
      harness.yandex.behaviour = { mode: 'normal' };

      const fresh = await enable(2_000_000n);
      expect(fresh.id).toBe(rule.id);
      expect(fresh.consecutiveFailures).toBe(0);
      expect(fresh.paused).toBe(false);
      expect(Money.fromMinor(fresh.threshold.minor, 'AMD').minor).toBe(2_000_000n);
    });
  });
});
