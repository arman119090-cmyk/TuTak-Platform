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
 * Balance history is a read model over withdrawals and the ledger — never a
 * second source of money truth. These tests create real operations and check
 * what the driver is shown for them.
 */
describe('balance history', () => {
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

  async function drive(withdrawalId: string, rounds = 8): Promise<string> {
    for (let i = 0; i < rounds; i += 1) {
      await harness.prisma.withdrawal.updateMany({
        where: { id: withdrawalId },
        data: { nextAttemptAt: null },
      });
      await harness.orchestrator.advance(withdrawalId);
    }
    return (await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } }))
      .state;
  }

  const list = (filter: Record<string, unknown> = {}) =>
    harness.history.list(driver.driverId, { limit: 20, ...filter } as never);

  describe('types and statuses', () => {
    it('shows a completed withdrawal with the gross amount, the balance after, and COMPLETED', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      expect((await list()).items[0]).toMatchObject({
        type: 'WITHDRAWAL',
        status: 'PROCESSING',
        amount: { minor: '-1000000', currency: 'AMD' },
        operationId: created.reference,
        origin: 'DRIVER',
      });

      expect(await drive(created.id)).toBe('COMPLETED');
      const [entry] = (await list()).items;
      expect(entry).toMatchObject({
        id: `w:${created.id}`,
        type: 'WITHDRAWAL',
        status: 'COMPLETED',
        balanceAfter: { minor: '4000000', currency: 'AMD' },
        park: { id: driver.parkId },
      });
    });

    it('shows a refused withdrawal as REJECTED with the reason', async () => {
      harness.yandex.behaviour = { mode: 'reject' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      expect(await drive(created.id)).toBe('FAILED');
      const [entry] = (await list()).items;
      expect(entry).toMatchObject({ status: 'REJECTED', comment: 'mock_rejected' });
    });

    it('shows a compensated withdrawal as CANCELLED plus a REFUND line', async () => {
      harness.provider.behaviour = { mode: 'reject', code: 'declined' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      expect(await drive(created.id)).toBe('REVERSED');

      const items = (await list()).items;
      expect(items.map((entry) => entry.type)).toEqual(['REFUND', 'WITHDRAWAL']);
      expect(items[0]).toMatchObject({
        type: 'REFUND',
        status: 'COMPLETED',
        amount: { minor: '1000000', currency: 'AMD' },
        operationId: created.reference,
        origin: 'SYSTEM',
        withdrawalId: created.id,
      });
      expect(items[1]).toMatchObject({ type: 'WITHDRAWAL', status: 'CANCELLED' });
    });

    it('shows an operator adjustment as ADMIN_ADJUSTMENT with its reason and sign', async () => {
      await harness.admin.adjustDriverBalance(driver.driverId, ADMIN, {
        direction: 'CREDIT',
        amount: { minor: '50000', currency: 'AMD' },
        reason: 'fee waived after a support call',
      });
      await harness.admin.adjustDriverBalance(driver.driverId, ADMIN, {
        direction: 'DEBIT',
        amount: { minor: '20000', currency: 'AMD' },
        reason: 'correction of the previous one',
      });
      const items = (await list()).items;
      expect(items).toHaveLength(2);
      expect(items[1]).toMatchObject({
        type: 'ADMIN_ADJUSTMENT',
        status: 'COMPLETED',
        amount: { minor: '50000', currency: 'AMD' },
        comment: 'fee waived after a support call',
        origin: 'ADMIN',
      });
      expect(items[0]).toMatchObject({ amount: { minor: '-20000', currency: 'AMD' } });

      // The books still balance, and the entry is in the ledger, not a side table.
      for (const line of await harness.ledger.trialBalance()) {
        expect(line.difference).toBe(0n);
      }
      const payable = await harness.ledger.balanceOf('DRIVER_PAYABLE', driver.driverId, 'AMD');
      expect(payable.minor).toBe(30_000n);
    });

    it('marks an automatic payout with its origin', async () => {
      await harness.idram.link(driver.driverId, { accountId: '094123456' });
      const consent = await harness.security.authorize(
        driver.driverId,
        { userId: driver.userId, deviceId: driver.deviceId },
        { method: 'PIN', pin: '482913', purpose: 'AUTO_PAYOUT' },
      );
      const rule = await harness.autoPayout.upsert(driver.driverId, {
        cadence: 'ON_THRESHOLD',
        threshold: { minor: '1000000', currency: 'AMD' },
        authorizationToken: consent.authorizationToken,
      });
      await harness.autoPayout.evaluate(rule.id);
      expect((await list()).items[0]).toMatchObject({ type: 'WITHDRAWAL', origin: 'AUTO_PAYOUT' });
    });
  });

  describe('filters and paging', () => {
    beforeEach(async () => {
      const first = await requestWithdrawal(harness, driver, 1_000_000n);
      await drive(first.id);
      // Rows are stamped by the database clock; move the first one into the past.
      await harness.prisma.withdrawal.update({
        where: { id: first.id },
        data: { createdAt: new Date(Date.now() - 7_200_000) },
      });
      harness.provider.behaviour = { mode: 'reject', code: 'declined' };
      const second = await requestWithdrawal(harness, driver, 500_000n);
      await drive(second.id);
      harness.provider.behaviour = { mode: 'confirm' };
      await harness.admin.adjustDriverBalance(driver.driverId, ADMIN, {
        direction: 'CREDIT',
        amount: { minor: '10000', currency: 'AMD' },
        reason: 'goodwill credit',
      });
    });

    it('filters by type', async () => {
      expect((await list({ type: 'WITHDRAWAL' })).items.map((e) => e.type)).toEqual([
        'WITHDRAWAL',
        'WITHDRAWAL',
      ]);
      expect((await list({ type: 'REFUND' })).items).toHaveLength(1);
      expect((await list({ type: 'ADMIN_ADJUSTMENT' })).items).toHaveLength(1);
      expect((await list({ type: 'CREDIT' })).items).toHaveLength(0);
    });

    it('filters by status', async () => {
      const completed = (await list({ status: 'COMPLETED' })).items;
      expect(completed.map((e) => e.type).sort()).toEqual([
        'ADMIN_ADJUSTMENT',
        'REFUND',
        'WITHDRAWAL',
      ]);
      const cancelled = (await list({ status: 'CANCELLED' })).items;
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]?.amount.minor).toBe('-500000');
    });

    it('filters by period', async () => {
      // Everything after the clock moved: the second withdrawal, its refund, the adjustment.
      const since = new Date(Date.now() - 1_800_000).toISOString();
      const recent = (await list({ from: since })).items;
      expect(recent.map((e) => e.type).sort()).toEqual([
        'ADMIN_ADJUSTMENT',
        'REFUND',
        'WITHDRAWAL',
      ]);
      const old = (await list({ to: since })).items;
      expect(old).toHaveLength(1);
      expect(old[0]?.amount.minor).toBe('-1000000');
    });

    it('pages with a cursor, newest first, without repeating or skipping', async () => {
      const first = await list({ limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await list({ limit: 2, cursor: first.nextCursor });
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      const ids = [...first.items, ...second.items].map((e) => e.id);
      expect(new Set(ids).size).toBe(4);
      const times = [...first.items, ...second.items].map((e) => e.at);
      expect([...times].sort().reverse()).toEqual(times);
    });
  });

  describe('operation details', () => {
    it('returns the withdrawal, its timeline and nothing of another driver’s', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await drive(created.id);
      const detail = await harness.history.detail(driver.driverId, `w:${created.id}`);
      expect(detail.withdrawal?.id).toBe(created.id);
      expect(detail.withdrawal?.userStatus).toBe('COMPLETED');
      expect(detail.timeline.map((e) => e.state)).toContain('COMPLETED');

      const other = await seedDriver(harness, {
        phone: '+37411000002',
        contractorProfileId: 'contractor-0002',
      });
      await expect(harness.history.detail(other.driverId, `w:${created.id}`)).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    });

    it('returns the balanced postings behind an adjustment', async () => {
      await harness.admin.adjustDriverBalance(driver.driverId, ADMIN, {
        direction: 'CREDIT',
        amount: { minor: '50000', currency: 'AMD' },
        reason: 'fee waived',
      });
      const [entry] = (await list()).items;
      const detail = await harness.history.detail(driver.driverId, entry!.id);
      expect(detail.withdrawal).toBeNull();
      expect(detail.postings).toHaveLength(2);
      expect(detail.postings.map((p) => p.direction).sort()).toEqual(['CREDIT', 'DEBIT']);
    });
  });
});
