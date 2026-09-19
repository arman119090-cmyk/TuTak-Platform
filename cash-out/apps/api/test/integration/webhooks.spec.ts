import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  SeededDriver,
  seedPricing,
} from '../harness';

describe('provider webhooks', () => {
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
    harness.yandex.reset();
    harness.provider.reset();
    await seedPricing(harness.prisma);
    driver = await seedDriver(harness, { balance: 5_000_000n });
  });

  /** Brings a withdrawal to PAYOUT_SUBMITTED, which is where webhooks matter. */
  async function submittedWithdrawal() {
    harness.provider.behaviour = { mode: 'submit' };
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    await harness.orchestrator.advance(created.id, 6);
    const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.state).toBe('PAYOUT_SUBMITTED');
    return row;
  }

  function deliver(body: string, at = harness.clock.nowMs()) {
    const headers = harness.provider.signPayload(body, Math.floor(at / 1000));
    return harness.webhooks.handle(body, headers);
  }

  describe('authentication', () => {
    it('refuses a delivery with no signature', async () => {
      const body = JSON.stringify({ id: 'evt_1', type: 'payout.confirmed' });
      await expect(harness.webhooks.handle(body, {})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('refuses a forged signature', async () => {
      const body = JSON.stringify({ id: 'evt_1', type: 'payout.confirmed' });
      await expect(
        harness.webhooks.handle(body, {
          'x-provider-signature': 'deadbeef',
          'x-provider-timestamp': String(Math.floor(harness.clock.nowMs() / 1000)),
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('refuses a replay of a correctly signed delivery from an hour ago', async () => {
      const withdrawal = await submittedWithdrawal();
      const body = harness.provider.buildWebhookBody(
        withdrawal.providerIdempotencyKey,
        'payout.confirmed',
      );
      const stale = harness.clock.nowMs() - 3_600_000;

      await expect(deliver(body, stale)).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const after = await harness.prisma.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
      });
      expect(after.state).toBe('PAYOUT_SUBMITTED');
    });

    it('refuses a body that was altered after signing', async () => {
      const withdrawal = await submittedWithdrawal();
      const body = harness.provider.buildWebhookBody(
        withdrawal.providerIdempotencyKey,
        'payout.confirmed',
      );
      const headers = harness.provider.signPayload(body, Math.floor(harness.clock.nowMs() / 1000));
      const tampered = body.replace('payout.confirmed', 'payout.failed');

      await expect(harness.webhooks.handle(tampered, headers)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('processing', () => {
    it('settles a submitted payout', async () => {
      const withdrawal = await submittedWithdrawal();
      const body = harness.provider.buildWebhookBody(
        withdrawal.providerIdempotencyKey,
        'payout.confirmed',
      );

      const result = await deliver(body);
      expect(result).toEqual({ status: 'processed', withdrawalId: withdrawal.id });

      const after = await harness.prisma.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
      });
      expect(after.state).toBe('PAYOUT_CONFIRMED');
    });

    it('applies a redelivered event exactly once', async () => {
      const withdrawal = await submittedWithdrawal();
      const body = harness.provider.buildWebhookBody(
        withdrawal.providerIdempotencyKey,
        'payout.confirmed',
      );

      const first = await deliver(body);
      const second = await deliver(body);

      expect(first.status).toBe('processed');
      expect(second.status).toBe('duplicate');
      expect(await harness.prisma.providerEvent.count()).toBe(1);

      const events = await harness.prisma.withdrawalEvent.count({
        where: { withdrawalId: withdrawal.id, toState: 'PAYOUT_CONFIRMED' },
      });
      expect(events).toBe(1);
    });

    it('ignores an event that does not apply in the current state', async () => {
      const withdrawal = await submittedWithdrawal();
      await deliver(
        harness.provider.buildWebhookBody(withdrawal.providerIdempotencyKey, 'payout.confirmed'),
      );
      await harness.orchestrator.advance(withdrawal.id, 3); // -> COMPLETED

      // A late "submitted" for a finished withdrawal must not move it.
      const result = await deliver(
        harness.provider.buildWebhookBody(withdrawal.providerIdempotencyKey, 'payout.submitted'),
      );
      expect(result.status).toBe('ignored');

      const after = await harness.prisma.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
      });
      expect(after.state).toBe('COMPLETED');
    });

    it('records an event for an unknown reference without failing', async () => {
      const body = JSON.stringify({
        id: 'evt_unknown_1',
        type: 'payout.confirmed',
        reference: 'CO-XXXXX-XXXXX',
        provider_transaction_id: 'psp_unknown',
        occurred_at: new Date(harness.clock.nowMs()).toISOString(),
        currency: 'AMD',
      });
      const result = await deliver(body);
      expect(result).toEqual({ status: 'ignored', reason: 'unknown_reference' });
      expect(await harness.prisma.providerEvent.count()).toBe(1);
    });

    it('reverses a settled payout and returns the money to the driver', async () => {
      const withdrawal = await submittedWithdrawal();
      await deliver(
        harness.provider.buildWebhookBody(withdrawal.providerIdempotencyKey, 'payout.confirmed'),
      );
      await harness.orchestrator.advance(withdrawal.id, 3);

      let row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
      expect(row.state).toBe('COMPLETED');
      expect(harness.yandex.balanceOf(driver.parkId, driver.contractorProfileId)?.minor).toBe(
        4_000_000n,
      );

      await deliver(
        harness.provider.buildWebhookBody(withdrawal.providerIdempotencyKey, 'payout.returned', {
          failure_code: 'account_closed',
        }),
      );
      for (let i = 0; i < 4; i += 1) {
        await harness.orchestrator.advance(withdrawal.id, 3);
      }

      row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
      expect(row.state).toBe('REVERSED');
      expect(harness.yandex.balanceOf(driver.parkId, driver.contractorProfileId)?.minor).toBe(
        5_000_000n,
      );

      for (const balance of await harness.ledger.trialBalance()) {
        expect(balance.difference).toBe(0n);
      }
    });

    it('ignores an event whose provider transaction id does not match', async () => {
      const withdrawal = await submittedWithdrawal();
      const body = harness.provider.buildWebhookBody(
        withdrawal.providerIdempotencyKey,
        'payout.confirmed',
        { provider_transaction_id: 'psp_somebody_elses_transfer' },
      );

      const result = await deliver(body);
      expect(result).toEqual({ status: 'ignored', reason: 'transaction_id_mismatch' });

      const after = await harness.prisma.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
      });
      expect(after.state).toBe('PAYOUT_SUBMITTED');
    });
  });
});
