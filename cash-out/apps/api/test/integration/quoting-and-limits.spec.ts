import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
} from '../harness';

describe('quoting and limits', () => {
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
  });

  async function setup(pricing: Parameters<typeof seedPricing>[1] = {}, balance = 5_000_000n) {
    await seedPricing(harness.prisma, pricing);
    driver = await seedDriver(harness, { balance });
  }

  const quote = (amountMinor: bigint) =>
    harness.quotes.create(driver.driverId, {
      payoutMethodId: driver.payoutMethodId,
      amount: { minor: amountMinor.toString(), currency: 'AMD' },
      all: false,
    });

  describe('the quote itself', () => {
    it('shows the fee breakdown that will actually be charged', async () => {
      await setup();
      const result = await quote(1_000_000n);

      expect(result.gross).toEqual({ minor: '1000000', currency: 'AMD' });
      expect(result.platformFee).toEqual({ minor: '25000', currency: 'AMD' });
      expect(result.providerFee).toEqual({ minor: '7000', currency: 'AMD' });
      expect(result.totalFee).toEqual({ minor: '32000', currency: 'AMD' });
      expect(result.net).toEqual({ minor: '968000', currency: 'AMD' });
      expect(BigInt(result.net.minor) + BigInt(result.totalFee.minor)).toBe(
        BigInt(result.gross.minor),
      );
    });

    it('refuses a tampered signature', async () => {
      await setup();
      const result = await quote(1_000_000n);

      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: result.quoteId,
          signature: 'not-the-signature',
          idempotencyKey: 'tampered-signature-key-01',
        }),
      ).rejects.toMatchObject({ code: 'QUOTE_MISMATCH' });
    });

    it('refuses a quote whose amounts were edited in the database', async () => {
      await setup();
      const result = await quote(1_000_000n);

      // An edit that does not add up is stopped by the database itself.
      await expect(
        harness.prisma.quote.update({
          where: { id: result.quoteId },
          data: { platformFeeMinor: 1n },
        }),
      ).rejects.toThrow(/quotes_amounts_balance/);

      // An edit that does add up gets past the constraint — and is caught by
      // the signature, which is why the signature exists.
      await harness.prisma.quote.update({
        where: { id: result.quoteId },
        data: { platformFeeMinor: 1n, providerFeeMinor: 7_000n, netMinor: 992_999n },
      });

      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: result.quoteId,
          signature: result.signature,
          idempotencyKey: 'edited-quote-key-01234567',
        }),
      ).rejects.toMatchObject({ code: 'QUOTE_MISMATCH' });
    });

    it('refuses an expired quote', async () => {
      await setup();
      const result = await quote(1_000_000n);
      harness.clock.advanceSeconds(121);

      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: result.quoteId,
          signature: result.signature,
          idempotencyKey: 'expired-quote-key-0123456',
        }),
      ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    });

    it('refuses another driver’s quote', async () => {
      await setup();
      const mine = await quote(1_000_000n);
      const other = await seedDriver(harness, {
        phone: '+37411000002',
        contractorProfileId: 'contractor-0002',
      });

      await expect(
        harness.withdrawals.confirm(other.driverId, {
          quoteId: mine.quoteId,
          signature: mine.signature,
          idempotencyKey: 'someone-elses-quote-key-1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses a quote that has already been spent', async () => {
      await setup();
      const result = await quote(1_000_000n);
      const created = await harness.withdrawals.confirm(driver.driverId, {
        quoteId: result.quoteId,
        signature: result.signature,
        idempotencyKey: 'spend-once-key-0123456789',
      });
      await harness.orchestrator.advance(created.id, 8);

      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: result.quoteId,
          signature: result.signature,
          idempotencyKey: 'spend-twice-key-012345678',
        }),
      ).rejects.toMatchObject({ code: 'QUOTE_MISMATCH' });
    });

    it('refuses more than the balance', async () => {
      await setup({}, 1_000_000n);
      await expect(quote(2_000_000n)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    });

    it('refuses an amount that does not cover the fees', async () => {
      await setup({ minWithdrawalMinor: 1n });
      await expect(quote(1_000n)).rejects.toMatchObject({
        code: 'AMOUNT_DOES_NOT_COVER_FEES',
      });
    });

    it('prices from a fresh balance, and refuses when Yandex is unreachable', async () => {
      await setup();
      harness.yandex.behaviour = { mode: 'unavailable' };
      await expect(quote(1_000_000n)).rejects.toMatchObject({ code: 'YANDEX_UNAVAILABLE' });
    });

    it('detects a balance that fell between quoting and confirming', async () => {
      await setup();
      const result = await quote(4_000_000n);

      // The driver spent their balance elsewhere in the meantime.
      harness.yandex.reset();
      harness.yandex.seed({
        parkId: driver.parkId,
        contractorProfileId: driver.contractorProfileId,
        phone: driver.phone,
        firstName: 'Ara',
        lastName: 'Sargsyan',
        licenceNumber: 'AM1234567',
        balance: (await import('@cashout/money')).Money.fromMinor(1_000_000n, 'AMD'),
      });

      await expect(
        harness.withdrawals.confirm(driver.driverId, {
          quoteId: result.quoteId,
          signature: result.signature,
          idempotencyKey: 'balance-dropped-key-01234',
        }),
      ).rejects.toMatchObject({ code: 'BALANCE_CHANGED' });
    });
  });

  describe('limits', () => {
    it('refuses an amount below the minimum', async () => {
      await setup({ minWithdrawalMinor: 500_000n });
      await expect(quote(200_000n)).rejects.toMatchObject({ code: 'AMOUNT_BELOW_MINIMUM' });
    });

    it('refuses an amount above the maximum', async () => {
      await setup({ maxWithdrawalMinor: 500_000n });
      await expect(quote(1_000_000n)).rejects.toMatchObject({ code: 'AMOUNT_ABOVE_MAXIMUM' });
    });

    it('counts in-flight withdrawals against the daily cap, not just finished ones', async () => {
      await setup({ dailyAmountMinor: 1_500_000n });
      const first = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(first.id, 2); // still in flight

      await expect(quote(1_000_000n)).rejects.toMatchObject({ code: 'DAILY_LIMIT_EXCEEDED' });
    });

    it('stops counting a withdrawal that failed without moving money', async () => {
      await setup({ dailyAmountMinor: 1_500_000n });
      harness.yandex.behaviour = { mode: 'reject' };
      const failed = await requestWithdrawal(harness, driver, 1_000_000n);
      await harness.orchestrator.advance(failed.id, 6);
      expect(
        (await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: failed.id } })).state,
      ).toBe('FAILED');

      harness.yandex.behaviour = { mode: 'normal' };
      await expect(quote(1_000_000n)).resolves.toBeDefined();
    });

    it('enforces the per-day count', async () => {
      await setup({ dailyCountMax: 2, velocityMaxCount: 10 });
      for (let i = 0; i < 2; i += 1) {
        const created = await requestWithdrawal(
          harness,
          driver,
          200_000n,
          `daily-key-${i}-0000000`,
        );
        await harness.orchestrator.advance(created.id, 8);
      }
      await expect(quote(200_000n)).rejects.toMatchObject({ code: 'DAILY_LIMIT_EXCEEDED' });
    });

    it('enforces the velocity window', async () => {
      await setup({ velocityMaxCount: 1, dailyCountMax: 10 });
      const created = await requestWithdrawal(harness, driver, 200_000n);
      await harness.orchestrator.advance(created.id, 8);

      await expect(quote(200_000n)).rejects.toMatchObject({ code: 'VELOCITY_LIMIT_EXCEEDED' });
    });

    it('sends an unusually large withdrawal to a human instead of the bank', async () => {
      await setup({ manualReviewAboveMinor: 500_000n });
      const created = await requestWithdrawal(harness, driver, 1_000_000n);
      const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.manualReviewReason).toMatch(/above the automatic-approval threshold/);
    });
  });

  describe('pricing with a payout increment', () => {
    it('leaves the sub-increment remainder on the balance rather than losing it', async () => {
      await setup({ payoutIncrementMinor: 100n });
      const result = await quote(1_000_037n);

      expect(BigInt(result.net.minor) % 100n).toBe(0n);
      expect(BigInt(result.gross.minor)).toBeLessThanOrEqual(1_000_037n);
      expect(BigInt(result.net.minor) + BigInt(result.totalFee.minor)).toBe(
        BigInt(result.gross.minor),
      );
    });
  });
});
