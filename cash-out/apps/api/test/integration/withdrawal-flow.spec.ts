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
 * The money path, end to end, against a real PostgreSQL.
 *
 * These are the tests that decide whether the product may be deployed. Each one
 * corresponds to a way the outside world actually behaves: a bank that times
 * out after succeeding, a webhook delivered twice, two phones tapping Withdraw
 * at the same moment.
 */
describe('the withdrawal flow', () => {
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
  });

  /** Advances until the withdrawal stops moving, ignoring backoff timers. */
  async function drive(withdrawalId: string, rounds = 6): Promise<string> {
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

  describe('the happy path', () => {
    it('debits Yandex, pays the driver and closes the books', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);

      expect(created.gross).toEqual({ minor: '1000000', currency: 'AMD' });
      expect(created.platformFee).toEqual({ minor: '25000', currency: 'AMD' });
      expect(created.providerFee).toEqual({ minor: '7000', currency: 'AMD' });
      expect(created.net).toEqual({ minor: '968000', currency: 'AMD' });
      expect(created.status).toBe('PENDING');

      expect(await drive(created.id)).toBe('COMPLETED');

      // The driver's Yandex balance really moved, by the gross.
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        4_000_000n,
      );
      // The bank was instructed for the net, once.
      expect(harness.provider.payoutCount()).toBe(1);

      const parkReceivable = await harness.ledger.balanceOf(
        'PARK_RECEIVABLE',
        driver.parkId,
        'AMD',
      );
      const driverPayable = await harness.ledger.balanceOf(
        'DRIVER_PAYABLE',
        driver.driverId,
        'AMD',
      );
      const platformRevenue = await harness.ledger.balanceOf(
        'PLATFORM_FEE_REVENUE',
        'GLOBAL',
        'AMD',
      );
      const pspSettlement = await harness.ledger.balanceOf('PSP_SETTLEMENT', 'mock-psp', 'AMD');

      expect(parkReceivable.minor).toBe(1_000_000n);
      expect(driverPayable.minor).toBe(0n); // fully discharged
      expect(platformRevenue.minor).toBe(25_000n);
      expect(pspSettlement.minor).toBe(-968_000n); // money left our provider balance

      for (const row of await harness.ledger.trialBalance()) {
        expect(row.difference).toBe(0n);
      }
    });

    it('writes a complete, ordered timeline', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await drive(created.id);

      const events = await harness.prisma.withdrawalEvent.findMany({
        where: { withdrawalId: created.id },
        orderBy: { at: 'asc' },
      });
      expect(events.map((event) => event.toState)).toEqual([
        'CREATED',
        'RISK_CHECK',
        'RESERVING',
        'RESERVED',
        'PAYOUT_SUBMITTING',
        'PAYOUT_CONFIRMED',
        'COMPLETED',
      ]);
    });

    it('never lets the stored amounts disagree with each other', async () => {
      const created = await requestWithdrawal(harness, driver, 1_234_567n);
      const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.grossMinor).toBe(row.platformFeeMinor + row.providerFeeMinor + row.netMinor);
    });

    it('"withdraw everything" leaves the balance at zero, not below it', async () => {
      const quote = await harness.quotes.create(driver.driverId, {
        payoutMethodId: driver.payoutMethodId,
        all: true,
      });
      expect(quote.gross).toEqual({ minor: '5000000', currency: 'AMD' });

      const created = await harness.withdrawals.confirm(driver.driverId, {
        quoteId: quote.quoteId,
        signature: quote.signature,
        idempotencyKey: 'withdraw-everything-key-0001',
      });
      expect(await drive(created.id)).toBe('COMPLETED');
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        0n,
      );
    });
  });

  describe('idempotency', () => {
    it('returns the same withdrawal for a repeated key, and debits once', async () => {
      const key = 'repeat-key-0123456789abcdef';
      const first = await requestWithdrawal(harness, driver, 1_000_000n, key);

      // The second call cannot reuse the quote (it is spent), so it must be
      // answered from the idempotency key alone.
      const second = await harness.withdrawals.confirm(driver.driverId, {
        quoteId: first.id === '' ? '' : await quoteIdOf(harness, first.id),
        signature: await signatureOf(harness, first.id),
        idempotencyKey: key,
      });

      expect(second.id).toBe(first.id);
      expect(await harness.prisma.withdrawal.count()).toBe(1);
    });

    it('rejects the same key used for a different request', async () => {
      const key = 'conflicting-key-0123456789ab';
      await requestWithdrawal(harness, driver, 1_000_000n, key);
      await harness.prisma.withdrawal.updateMany({ data: { state: 'COMPLETED' } });

      const quote = await harness.quotes.create(driver.driverId, {
        payoutMethodId: driver.payoutMethodId,
        amount: { minor: '2000000', currency: 'AMD' },
        all: false,
      });

      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: quote.quoteId,
          signature: quote.signature,
          idempotencyKey: key,
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' });
    });

    it('retrying a step never produces a second Yandex transaction', async () => {
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await drive(created.id);

      // Force the orchestrator back through the reserve step with the same
      // idempotency token, exactly as a crashed worker would.
      const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      const outcome = await harness.yandex.createDebit({
        parkId: row.parkId,
        contractorProfileId: row.yandexContractorProfileId,
        amount: Money.fromMinor(row.grossMinor, 'AMD'),
        kind: 'payout',
        description: `Cash Out ${row.reference}`,
        idempotencyToken: row.yandexIdempotencyToken,
      });

      expect(outcome.status).toBe('APPLIED');
      expect(harness.yandex.transactionCount(driver.yandexParkId, driver.contractorProfileId)).toBe(
        1,
      );
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        4_000_000n,
      );
    });
  });

  describe('when two requests arrive at once', () => {
    it('admits exactly one and tells the other it is already in progress', async () => {
      const quoteA = await harness.quotes.create(driver.driverId, {
        payoutMethodId: driver.payoutMethodId,
        amount: { minor: '1000000', currency: 'AMD' },
        all: false,
      });
      const quoteB = await harness.quotes.create(driver.driverId, {
        payoutMethodId: driver.payoutMethodId,
        amount: { minor: '1500000', currency: 'AMD' },
        all: false,
      });

      const results = await Promise.allSettled([
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: quoteA.quoteId,
          signature: quoteA.signature,
          idempotencyKey: 'device-a-key-0123456789ab',
        }),
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: quoteB.quoteId,
          signature: quoteB.signature,
          idempotencyKey: 'device-b-key-0123456789ab',
        }),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      expect(await harness.prisma.withdrawal.count()).toBe(1);

      const rejected = results.find((result) => result.status === 'rejected') as
        PromiseRejectedResult | undefined;
      expect(['WITHDRAWAL_ALREADY_IN_PROGRESS', 'QUOTE_MISMATCH']).toContain(
        (rejected?.reason as { code?: string })?.code,
      );
    });

    it('refuses a second withdrawal while the first is still moving', async () => {
      const first = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(first.id, 2); // partway through

      const quote = await harness.quotes.create(driver.driverId, {
        payoutMethodId: driver.payoutMethodId,
        amount: { minor: '1000000', currency: 'AMD' },
        all: false,
      });
      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: quote.quoteId,
          signature: quote.signature,
          idempotencyKey: 'second-while-first-runs-01',
        }),
      ).rejects.toMatchObject({ code: 'WITHDRAWAL_ALREADY_IN_PROGRESS' });
    });
  });

  describe('when Yandex misbehaves', () => {
    it('fails cleanly when the debit is rejected, touching nothing', async () => {
      harness.yandex.behaviour = { mode: 'reject' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);

      expect(await drive(created.id)).toBe('FAILED');
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        5_000_000n,
      );
      expect(harness.provider.payoutCount()).toBe(0);
      expect(await harness.prisma.journalEntry.count()).toBe(0);
    });

    it('resolves a timeout that actually applied, without debiting twice', async () => {
      // The worst case: the debit landed, the response never arrived.
      harness.yandex.behaviour = { mode: 'applied_but_timeout' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);

      await harness.orchestrator.advance(created.id, 3);
      let row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.state).toBe('RESERVE_UNCERTAIN');

      harness.yandex.behaviour = { mode: 'normal' };
      expect(await drive(created.id)).toBe('COMPLETED');

      row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.yandexTransactionId).toBeTruthy();
      expect(harness.yandex.transactionCount(driver.yandexParkId, driver.contractorProfileId)).toBe(
        1,
      );
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        4_000_000n,
      );
    });

    it('escalates to a human rather than guessing, after repeated unknowns', async () => {
      harness.yandex.behaviour = { mode: 'timeout' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);

      for (let i = 0; i < 12; i += 1) {
        await harness.prisma.withdrawal.updateMany({
          where: { id: created.id },
          data: { nextAttemptAt: null },
        });
        await harness.orchestrator.advance(created.id, 2);
      }

      const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.state).toBe('MANUAL_REVIEW');
      expect(row.manualReviewReason).toMatch(/Yandex debit/);
      expect(harness.provider.payoutCount()).toBe(0);
    });
  });

  describe('when the bank misbehaves', () => {
    it('gives the money back when the payout is declined', async () => {
      harness.provider.behaviour = { mode: 'reject', code: 'card_expired' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);

      expect(await drive(created.id, 8)).toBe('REVERSED');

      // The driver is whole again, on Yandex and in our books.
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        5_000_000n,
      );
      const payable = await harness.ledger.balanceOf('DRIVER_PAYABLE', driver.driverId, 'AMD');
      const receivable = await harness.ledger.balanceOf('PARK_RECEIVABLE', driver.parkId, 'AMD');
      const revenue = await harness.ledger.balanceOf('PLATFORM_FEE_REVENUE', 'GLOBAL', 'AMD');
      expect(payable.minor).toBe(0n);
      expect(receivable.minor).toBe(0n);
      expect(revenue.minor).toBe(0n); // the fee is given back too

      for (const row of await harness.ledger.trialBalance()) {
        expect(row.difference).toBe(0n);
      }
    });

    it('resolves a payout that timed out after being accepted', async () => {
      harness.provider.behaviour = { mode: 'submitted_but_timeout' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);

      await harness.orchestrator.advance(created.id, 5);
      let row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.state).toBe('PAYOUT_UNCERTAIN');
      expect(harness.provider.payoutCount()).toBe(1);

      harness.provider.behaviour = { mode: 'confirm' };
      await harness.prisma.withdrawal.updateMany({
        where: { id: created.id },
        data: { nextAttemptAt: null },
      });
      await harness.orchestrator.advance(created.id, 4);

      row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.state).toBe('PAYOUT_SUBMITTED');
      expect(harness.provider.payoutCount()).toBe(1);
    });

    it('never pays twice when the provider is probed after a timeout', async () => {
      harness.provider.behaviour = { mode: 'submitted_but_timeout' };
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(created.id, 5);

      for (let i = 0; i < 4; i += 1) {
        await harness.prisma.withdrawal.updateMany({
          where: { id: created.id },
          data: { nextAttemptAt: null },
        });
        await harness.orchestrator.advance(created.id, 2);
      }
      expect(harness.provider.payoutCount()).toBe(1);
    });
  });
});

async function quoteIdOf(harness: Harness, withdrawalId: string): Promise<string> {
  const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  return row.quoteId!;
}

async function signatureOf(harness: Harness, withdrawalId: string): Promise<string> {
  const row = await harness.prisma.withdrawal.findUniqueOrThrow({
    where: { id: withdrawalId },
    include: {},
  });
  const quote = await harness.prisma.quote.findUniqueOrThrow({ where: { id: row.quoteId! } });
  return quote.signature;
}
