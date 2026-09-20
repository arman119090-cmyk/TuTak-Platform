import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
  TEST_PIN,
} from '../harness';

/**
 * Notifications — through the outbox, against the **mock** push adapter.
 *
 * Green here proves that the right event queues the right kind, inside the
 * same transaction as the change; that preferences gate delivery; and that a
 * failed delivery is retried and eventually given up. It proves nothing about
 * a real push service, which this project has none of yet.
 */
describe('notifications', () => {
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
    harness.push.reset();
    await seedPricing(harness.prisma);
    driver = await seedDriver(harness, { balance: 5_000_000n });
  });

  async function drive(withdrawalId: string, rounds = 8): Promise<string> {
    for (let i = 0; i < rounds; i += 1) {
      await harness.prisma.withdrawal.updateMany({
        where: { id: withdrawalId },
        data: { nextAttemptAt: null },
      });
      await harness.orchestrator.advance(withdrawalId);
    }
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    return row.state;
  }

  async function queued(driverId: string): Promise<string[]> {
    const rows = await harness.prisma.outboxMessage.findMany({
      where: { topic: 'notification' },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .map((row) => row.payload as { driverId: string; kind: string })
      .filter((body) => body.driverId === driverId)
      .map((body) => body.kind);
  }

  describe('preferences', () => {
    it('default to everything on, and report the delivery mode honestly as mock', async () => {
      const prefs = await harness.notifications.preferences(driver.driverId);
      expect(prefs).toEqual({
        payoutStatus: true,
        autoPayout: true,
        securityAlerts: true,
        parkChanges: true,
        pushRegistered: false,
        deliveryMode: 'mock',
      });
    });

    it('are updated one category at a time, and audited', async () => {
      const updated = await harness.notifications.updatePreferences(driver.driverId, {
        autoPayout: false,
      });
      expect(updated.autoPayout).toBe(false);
      expect(updated.payoutStatus).toBe(true);

      const again = await harness.notifications.updatePreferences(driver.driverId, {
        payoutStatus: false,
      });
      expect(again).toMatchObject({ autoPayout: false, payoutStatus: false });

      const audit = await harness.prisma.auditLog.findMany({
        where: { action: 'notifications.preferences_updated' },
      });
      expect(audit).toHaveLength(2);
    });

    it('records a push token without ever returning it', async () => {
      await harness.notifications.registerPushToken(
        driver.driverId,
        'ExponentPushToken[abc123]',
        'android',
      );
      const prefs = await harness.notifications.preferences(driver.driverId);
      expect(prefs.pushRegistered).toBe(true);
      expect(JSON.stringify(prefs)).not.toContain('abc123');
    });
  });

  describe('what gets queued', () => {
    it('a completed payout queues PAYOUT_COMPLETED, once', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      expect(await drive(created.id)).toBe('COMPLETED');
      expect(await queued(driver.driverId)).toEqual(['PAYOUT_COMPLETED']);
      // Advancing a finished withdrawal again queues nothing more.
      await harness.orchestrator.advance(created.id);
      expect(await queued(driver.driverId)).toEqual(['PAYOUT_COMPLETED']);
    });

    it('a rejected payout that was reversed queues PAYOUT_CANCELLED', async () => {
      harness.provider.behaviour = { mode: 'reject', code: 'insufficient_funds' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      expect(await drive(created.id)).toBe('REVERSED');
      expect(await queued(driver.driverId)).toEqual(['PAYOUT_CANCELLED']);
    });

    it('a PIN change queues a security alert', async () => {
      await harness.security.changePin(driver.driverId, TEST_PIN, '731905');
      expect(await queued(driver.driverId)).toEqual(['SECURITY_PIN_CHANGED']);
    });
  });

  describe('delivery', () => {
    it('hands each queued notification to the push port with the driver locale, and marks it processed', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await drive(created.id);

      const delivered = await harness.notifications.drain();
      expect(delivered).toBe(1);
      expect(harness.push.sent).toHaveLength(1);
      expect(harness.push.sent[0]).toMatchObject({
        driverId: driver.driverId,
        kind: 'PAYOUT_COMPLETED',
        locale: 'hy',
        pushToken: null,
      });

      // A second sweep finds nothing left.
      expect(await harness.notifications.drain()).toBe(0);
      expect(harness.push.sent).toHaveLength(1);
    });

    it('respects a category switched off — at delivery time, so it also covers what is already queued', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await drive(created.id);
      await harness.notifications.updatePreferences(driver.driverId, { payoutStatus: false });

      expect(await harness.notifications.drain()).toBe(0);
      expect(harness.push.sent).toHaveLength(0);
      const rows = await harness.prisma.outboxMessage.findMany({
        where: { topic: 'notification' },
      });
      expect(rows.every((row) => row.processedAt !== null)).toBe(true);
    });

    it('a category switched off does not silence the others', async () => {
      await harness.notifications.updatePreferences(driver.driverId, { payoutStatus: false });
      await harness.security.changePin(driver.driverId, TEST_PIN, '731905');
      expect(await harness.notifications.drain()).toBe(1);
      expect(harness.push.sent.map((n) => n.kind)).toEqual(['SECURITY_PIN_CHANGED']);
    });

    it('retries a failed delivery with backoff and gives up after five attempts', async () => {
      harness.push.behaviour = 'fail';
      await harness.security.changePin(driver.driverId, TEST_PIN, '731905');

      expect(await harness.notifications.drain()).toBe(0);
      let row = await harness.prisma.outboxMessage.findFirstOrThrow({
        where: { topic: 'notification' },
      });
      expect(row.attempts).toBe(1);
      expect(row.processedAt).toBeNull();
      expect(row.lastError).toContain('mock_push_failure');
      expect(row.availableAt.getTime()).toBeGreaterThan(harness.clock.now().getTime());

      // Not due yet: nothing happens.
      expect(await harness.notifications.drain()).toBe(0);
      row = await harness.prisma.outboxMessage.findFirstOrThrow({
        where: { topic: 'notification' },
      });
      expect(row.attempts).toBe(1);

      // Bring each retry forward until the sweeper gives up.
      for (let attempt = 2; attempt <= 5; attempt += 1) {
        await harness.prisma.outboxMessage.update({
          where: { id: row.id },
          data: { availableAt: harness.clock.now() },
        });
        await harness.notifications.drain();
        row = await harness.prisma.outboxMessage.findFirstOrThrow({
          where: { topic: 'notification' },
        });
        expect(row.attempts).toBe(attempt);
      }
      expect(row.processedAt).not.toBeNull();
      expect(harness.push.sent).toHaveLength(0);
    });
  });
});
