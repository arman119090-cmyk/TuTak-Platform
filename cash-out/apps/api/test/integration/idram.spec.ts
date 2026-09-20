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
 * The iDram destination and payouts to it — against the **mock** iDram.
 *
 * Green here proves the account model, the replacement rules and that the
 * orchestrator handles each answer the rail can give; it proves nothing about
 * iDram's real API, which this project has no documentation for.
 */
describe('iDram accounts and payouts', () => {
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

  describe('linking an account', () => {
    it('verifies the account with iDram, stores it masked, and makes it the destination', async () => {
      expect(await harness.idram.current(driver.driverId)).toBeNull();

      const linked = await harness.idram.link(driver.driverId, {
        accountId: '094123456',
        holderName: 'Ara Sargsyan',
      });
      expect(linked.kind).toBe('IDRAM');
      expect(linked.status).toBe('ACTIVE');
      expect(linked.maskedIdentifier).toBe('•••• 3456');
      expect(linked.holderName).toBe('Ara Sargsyan');
      expect(linked.isDefault).toBe(true);
      expect(linked.verifiedAt).not.toBeNull();

      const row = await harness.prisma.payoutMethod.findUniqueOrThrow({ where: { id: linked.id } });
      expect(row.providerTokenEnc).not.toContain('094123456');
      expect(JSON.stringify(linked)).not.toContain('094123456');

      const audit = await harness.prisma.auditLog.findMany({
        where: { action: 'idram.account_linked' },
      });
      expect(audit).toHaveLength(1);
    });

    it('rejects a wallet iDram does not know, and links nothing', async () => {
      await expect(
        harness.idram.link(driver.driverId, { accountId: '094120000' }),
      ).rejects.toMatchObject({ code: 'IDRAM_ACCOUNT_REJECTED' });
      expect(await harness.idram.current(driver.driverId)).toBeNull();
    });

    it('keeps a wallet that exists but is not yet allowed to receive as pending', async () => {
      const linked = await harness.idram.link(driver.driverId, { accountId: '094129999' });
      expect(linked.status).toBe('PENDING_VERIFICATION');
      expect(linked.verifiedAt).toBeNull();

      // A pending destination cannot be paid to.
      await expect(
        harness.quotes.create(driver.driverId, {
          payoutMethodId: linked.id,
          amount: { minor: '1000000', currency: 'AMD' },
          all: false,
        }),
      ).rejects.toMatchObject({ code: 'PAYOUT_METHOD_NOT_VERIFIED' });
    });

    it('reports iDram as unavailable rather than guessing', async () => {
      harness.provider.accountBehaviour = 'unavailable';
      await expect(
        harness.idram.link(driver.driverId, { accountId: '094123456' }),
      ).rejects.toMatchObject({ code: 'IDRAM_UNAVAILABLE' });
      expect(await harness.idram.current(driver.driverId)).toBeNull();
    });

    it('replaces the previous account and keeps exactly one active destination', async () => {
      const first = await harness.idram.link(driver.driverId, { accountId: '094123456' });
      const second = await harness.idram.link(driver.driverId, { accountId: '094654321' });

      expect(second.id).not.toBe(first.id);
      const current = await harness.idram.current(driver.driverId);
      expect(current?.id).toBe(second.id);

      const active = await harness.prisma.payoutMethod.findMany({
        where: { driverId: driver.driverId, kind: 'IDRAM', disabledAt: null },
      });
      expect(active).toHaveLength(1);
      const audit = await harness.prisma.auditLog.findMany({
        where: { action: 'idram.account_replaced' },
      });
      expect(audit).toHaveLength(1);
    });

    it('treats linking the same wallet twice as a no-op', async () => {
      const first = await harness.idram.link(driver.driverId, { accountId: '094123456' });
      const again = await harness.idram.link(driver.driverId, { accountId: '094123456' });
      expect(again.id).toBe(first.id);
    });

    it('refuses to replace the account while a payout to it is in flight', async () => {
      const linked = await harness.idram.link(driver.driverId, { accountId: '094123456' });
      await requestWithdrawal(harness, { ...driver, payoutMethodId: linked.id }, 1_000_000n);
      await expect(
        harness.idram.link(driver.driverId, { accountId: '094654321' }),
      ).rejects.toMatchObject({ code: 'WITHDRAWAL_ALREADY_IN_PROGRESS' });
      await expect(harness.idram.unlink(driver.driverId)).rejects.toMatchObject({
        code: 'WITHDRAWAL_ALREADY_IN_PROGRESS',
      });
    });
  });

  describe('paying out to iDram (mock)', () => {
    let methodId: string;

    beforeEach(async () => {
      methodId = (await harness.idram.link(driver.driverId, { accountId: '094123456' })).id;
    });

    it('success: debits the park balance and settles through the same pipeline', async () => {
      const created = await requestWithdrawal(
        harness,
        { ...driver, payoutMethodId: methodId },
        1_000_000n,
      );
      expect(created.payoutMethod.maskedIdentifier).toBe('•••• 3456');
      expect(await drive(created.id)).toBe('COMPLETED');
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        4_000_000n,
      );
      expect(harness.provider.payoutCount()).toBe(1);
      const payout = harness.provider.payoutFor(
        (await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } }))
          .providerIdempotencyKey,
      );
      expect(payout?.instrumentToken).toBe('idram_094123456');
    });

    it('reject: iDram declines, the debit is compensated, the driver is whole', async () => {
      harness.provider.behaviour = { mode: 'reject', code: 'idram_wallet_limit' };
      const created = await requestWithdrawal(
        harness,
        { ...driver, payoutMethodId: methodId },
        1_000_000n,
      );
      expect(await drive(created.id, 8)).toBe('REVERSED');
      expect(harness.yandex.balanceOf(driver.yandexParkId, driver.contractorProfileId)?.minor).toBe(
        5_000_000n,
      );
      const row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.failureCode).toBe('idram_wallet_limit');
    });

    it('timeout/unknown: nothing is assumed, the payout waits to be probed, and settles once iDram answers', async () => {
      harness.provider.behaviour = { mode: 'submitted_but_timeout' };
      const created = await requestWithdrawal(
        harness,
        { ...driver, payoutMethodId: methodId },
        1_000_000n,
      );
      await harness.orchestrator.advance(created.id, 5);
      let row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.state).toBe('PAYOUT_UNCERTAIN');
      // Exactly one instruction went to iDram, whatever the retries did.
      expect(harness.provider.payoutCount()).toBe(1);

      // Probing finds the instruction accepted: not paid twice, not failed.
      expect(await drive(created.id, 2)).toBe('PAYOUT_SUBMITTED');
      expect(harness.provider.payoutCount()).toBe(1);

      harness.provider.behaviour = { mode: 'confirm' };
      row = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: created.id } });
      harness.provider.settle(row.providerIdempotencyKey);
      expect(await drive(created.id, 6)).toBe('COMPLETED');
      expect(harness.provider.payoutCount()).toBe(1);
    });
  });
});
