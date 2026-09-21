import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import { BANK_TOPUP_ADAPTER, BankTopUpAdapter } from '../src/modules/customer-balance/bank-topup-adapter.interface';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * docs/ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md — the collection mechanism
 * `EV_ROAMING_RECEIVABLE` named as future work. A customer's own stored
 * balance is funded through a `BankTopUpAdapter` (Idram or otherwise, not
 * yet connected — the No-op adapter is what actually runs today, and it
 * honestly refuses rather than fabricating a top-up nobody paid for) and
 * spent automatically when a roaming session settles. These tests exercise
 * `CustomerBalanceService` directly; the roaming-side spend
 * (`collectFromBalance`) is covered in
 * `ev-roaming-financial-accounting.int-spec.ts`, next to the settlement flow
 * that calls it.
 */
describe('Customer prepaid balance (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let balance: CustomerBalanceService;
  let adapter: BankTopUpAdapter;

  const savedTopUpFlag = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;

  beforeAll(async () => {
    // These tests are about the top-up *mechanism*, so they turn the feature
    // on explicitly. It is off by default as of 15.09.2026 — crediting a
    // customer's stored balance is deposit-taking, and whether TuTak may do
    // that is an open legal question, not a technical one. What happens with
    // the flag off is a suite of its own: `customer-balance-disabled`.
    //
    // Set before the harness is built, not after: `@Module()` metadata and
    // `ConfigService` both read the environment at boot.
    process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = 'true';
    harness = await createTestHarness();
    prisma = harness.prisma;
    balance = harness.app.get(CustomerBalanceService);
    adapter = harness.app.get<BankTopUpAdapter>(BANK_TOPUP_ADAPTER);
  });

  afterAll(async () => {
    if (savedTopUpFlag === undefined) delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    else process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = savedTopUpFlag;
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const initiated = (providerReference = `PROVIDER-${randomUUID()}`) =>
    jest.spyOn(adapter, 'initiateTopUp').mockResolvedValue({ outcome: 'INITIATED', providerReference });

  const webhookCompletes = (providerReference: string) =>
    jest.spyOn(adapter, 'verifyTopUpWebhook').mockResolvedValue({ providerReference, outcome: 'COMPLETED' });

  describe('reading a balance', () => {
    it('reads zero for a customer who has never topped up', async () => {
      const { user } = await createCustomer(prisma);
      expect(await balance.getBalance(user.id)).toEqual({ balance: '0.0000', currency: 'AMD' });
    });
  });

  describe('without a real bank connected', () => {
    it('honestly declines rather than fabricating a top-up nobody paid for', async () => {
      const { user } = await createCustomer(prisma);

      const result = await balance.initiateTopUp(user.id, '5000');

      expect(result.status).toBe('DECLINED');
      expect(result.declineReason).toBe('top_up_not_configured');
      expect(await balance.getBalance(user.id)).toEqual({ balance: '0.0000', currency: 'AMD' });
    });
  });

  describe('initiating a top-up', () => {
    it('records a PENDING attempt and returns the redirect the bank gave', async () => {
      const { user } = await createCustomer(prisma);
      const providerReference = `PROVIDER-${randomUUID()}`;
      jest
        .spyOn(adapter, 'initiateTopUp')
        .mockResolvedValue({ outcome: 'INITIATED', providerReference, redirectUrl: 'https://bank.example/pay/123' });

      const result = await balance.initiateTopUp(user.id, '5000');

      expect(result.status).toBe('PENDING');
      expect(result.redirectUrl).toBe('https://bank.example/pay/123');
      const row = await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: result.topUpId } });
      expect(row.status).toBe('PENDING');
      expect(row.amount.toString()).toBe('5000');
      expect(row.providerReference).toBe(providerReference);
      // Not credited yet — only the webhook confirmation moves the ledger.
      expect(await balance.getBalance(user.id)).toEqual({ balance: '0.0000', currency: 'AMD' });
    });

    it('replays the stored result for a repeated idempotency key instead of initiating twice', async () => {
      const { user } = await createCustomer(prisma);
      const spy = initiated();

      const first = await balance.initiateTopUp(user.id, '5000', 'topup-key-1');
      const second = await balance.initiateTopUp(user.id, '5000', 'topup-key-1');

      expect(second).toEqual(first);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await prisma.balanceTopUp.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe('confirming a top-up', () => {
    it('credits the balance and posts a balanced ledger entry once the bank confirms', async () => {
      const { user } = await createCustomer(prisma);
      const providerReference = `PROVIDER-${randomUUID()}`;
      initiated(providerReference);
      const initiateResult = await balance.initiateTopUp(user.id, '5000');

      webhookCompletes(providerReference);
      await balance.confirmTopUpWebhook({ reference: providerReference }, {});

      expect(await balance.getBalance(user.id)).toEqual({ balance: '5000.0000', currency: 'AMD' });

      const topUp = await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: initiateResult.topUpId } });
      expect(topUp.status).toBe('COMPLETED');
      expect(topUp.ledgerTransactionId).not.toBeNull();

      const posting = await prisma.ledgerTransaction.findUniqueOrThrow({
        where: { id: topUp.ledgerTransactionId! },
        include: { postings: true },
      });
      expect(posting.kind).toBe('balance.topup.completed');
      expect(posting.postings).toHaveLength(2);
      const pspAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PSP_RECEIVABLE' } });
      const balanceAccount = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'CUSTOMER_PREPAID_BALANCE', userId: user.id },
      });
      const pspLeg = posting.postings.find((p) => p.accountId === pspAccount.id);
      const balanceLeg = posting.postings.find((p) => p.accountId === balanceAccount.id);
      expect(pspLeg?.direction).toBe('DEBIT');
      expect(pspLeg?.amount.toFixed(4)).toBe('5000.0000');
      expect(balanceLeg?.direction).toBe('CREDIT');
      expect(balanceLeg?.amount.toFixed(4)).toBe('5000.0000');
    });

    it('never double-credits when the same confirmation is delivered twice', async () => {
      const { user } = await createCustomer(prisma);
      const providerReference = `PROVIDER-${randomUUID()}`;
      initiated(providerReference);
      await balance.initiateTopUp(user.id, '5000');
      webhookCompletes(providerReference);

      await balance.confirmTopUpWebhook({ reference: providerReference }, {});
      await balance.confirmTopUpWebhook({ reference: providerReference }, {});

      expect(await balance.getBalance(user.id)).toEqual({ balance: '5000.0000', currency: 'AMD' });
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'balance.topup.completed' } }),
      ).toBe(1);
    });

    it('never double-credits when two deliveries of the same confirmation race', async () => {
      const { user } = await createCustomer(prisma);
      const providerReference = `PROVIDER-${randomUUID()}`;
      initiated(providerReference);
      await balance.initiateTopUp(user.id, '5000');
      webhookCompletes(providerReference);

      await Promise.all([
        balance.confirmTopUpWebhook({ reference: providerReference }, {}),
        balance.confirmTopUpWebhook({ reference: providerReference }, {}),
      ]);

      expect(await balance.getBalance(user.id)).toEqual({ balance: '5000.0000', currency: 'AMD' });
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'balance.topup.completed' } }),
      ).toBe(1);
    });

    it('marks a declined confirmation without ever touching the ledger', async () => {
      const { user } = await createCustomer(prisma);
      const providerReference = `PROVIDER-${randomUUID()}`;
      initiated(providerReference);
      const initiateResult = await balance.initiateTopUp(user.id, '5000');
      jest
        .spyOn(adapter, 'verifyTopUpWebhook')
        .mockResolvedValue({ providerReference, outcome: 'DECLINED', declineReason: 'insufficient_funds' });

      await balance.confirmTopUpWebhook({ reference: providerReference }, {});

      const topUp = await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: initiateResult.topUpId } });
      expect(topUp.status).toBe('DECLINED');
      expect(topUp.declineReason).toBe('insufficient_funds');
      expect(topUp.ledgerTransactionId).toBeNull();
      expect(await balance.getBalance(user.id)).toEqual({ balance: '0.0000', currency: 'AMD' });
    });

    it('refuses a callback the adapter could not verify', async () => {
      jest.spyOn(adapter, 'verifyTopUpWebhook').mockResolvedValue(null);

      await expect(balance.confirmTopUpWebhook({ reference: 'anything' }, {})).rejects.toThrow(
        /could not verify/i,
      );
    });

    it('quietly ignores a confirmation for a reference nothing here ever issued', async () => {
      jest.spyOn(adapter, 'verifyTopUpWebhook').mockResolvedValue({
        providerReference: 'never-issued',
        outcome: 'COMPLETED',
      });

      await expect(balance.confirmTopUpWebhook({ reference: 'never-issued' }, {})).resolves.toBeUndefined();
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'balance.topup.completed' } })).toBe(0);
    });
  });

  /**
   * Owner's brief §17 (20.09.2026): a timeout is not a decline. A top-up the
   * provider has not answered becomes UNRESOLVED — a state, not an outcome —
   * gets louder on a schedule, and is closed only by the provider's own
   * answer. Time never credits and never declines.
   */
  describe('an unanswered top-up', () => {
    const pendingSince = async (userId: string, minutesAgo: number) => {
      const providerReference = `PROVIDER-${randomUUID()}`;
      initiated(providerReference);
      const result = await balance.initiateTopUp(userId, '5000');
      await prisma.balanceTopUp.update({
        where: { id: result.topUpId },
        data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) },
      });
      return { topUpId: result.topUpId, providerReference };
    };

    it('becomes UNRESOLVED after the stale window and raises one alert; a fresh one is left alone', async () => {
      const { user } = await createCustomer(prisma);
      const stale = await pendingSince(user.id, 45);
      const fresh = await pendingSince(user.id, 5);
      harness.alerts.clear();

      const first = await balance.escalateStaleTopUps();
      expect(first).toEqual({ marked: 1, escalated: 1 });

      const staleRow = await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: stale.topUpId } });
      expect(staleRow.status).toBe('UNRESOLVED');
      expect(staleRow.unresolvedAt).not.toBeNull();
      expect(staleRow.escalationCount).toBe(1);
      // Not DECLINED, not FAILED, no ledger movement: nobody decided anything.
      expect(staleRow.ledgerTransactionId).toBeNull();
      expect(await balance.getBalance(user.id)).toEqual({ balance: '0.0000', currency: 'AMD' });
      const freshRow = await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: fresh.topUpId } });
      expect(freshRow.status).toBe('PENDING');

      const alerts = harness.alerts.sent.filter((a) => a.key.startsWith('balance.topup.unresolved:'));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.body).toContain(stale.topUpId);
      // The provider reference, never a phone number or a secret.
      expect(alerts[0]!.body).toContain(stale.providerReference);
      expect(alerts[0]!.body).not.toContain(user.phone);

      // Within the escalation window a second sweep stays quiet.
      const second = await balance.escalateStaleTopUps();
      expect(second).toEqual({ marked: 0, escalated: 0 });
      expect(harness.alerts.sent.filter((a) => a.key.startsWith('balance.topup.unresolved:'))).toHaveLength(1);
    });

    it('is credited exactly once when the provider finally answers COMPLETED', async () => {
      const { user } = await createCustomer(prisma);
      const { topUpId, providerReference } = await pendingSince(user.id, 45);
      await balance.escalateStaleTopUps();
      expect((await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: topUpId } })).status).toBe('UNRESOLVED');

      webhookCompletes(providerReference);
      await Promise.all([
        balance.confirmTopUpWebhook({ reference: providerReference }, {}),
        balance.confirmTopUpWebhook({ reference: providerReference }, {}),
      ]);

      const row = await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: topUpId } });
      expect(row.status).toBe('COMPLETED');
      expect(row.resolvedAt).not.toBeNull();
      expect(await balance.getBalance(user.id)).toEqual({ balance: '5000.0000', currency: 'AMD' });
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'balance.topup.completed' } })).toBe(1);
      // Resolved rows are never escalated again.
      expect(await balance.escalateStaleTopUps()).toEqual({ marked: 0, escalated: 0 });
    });

    it('is declined — not credited — when the provider finally answers DECLINED', async () => {
      const { user } = await createCustomer(prisma);
      const { topUpId, providerReference } = await pendingSince(user.id, 45);
      await balance.escalateStaleTopUps();
      jest
        .spyOn(adapter, 'verifyTopUpWebhook')
        .mockResolvedValue({ providerReference, outcome: 'DECLINED', declineReason: 'card_refused' });

      await balance.confirmTopUpWebhook({ reference: providerReference }, {});

      const row = await prisma.balanceTopUp.findUniqueOrThrow({ where: { id: topUpId } });
      expect(row.status).toBe('DECLINED');
      expect(row.declineReason).toBe('card_refused');
      expect(await balance.getBalance(user.id)).toEqual({ balance: '0.0000', currency: 'AMD' });
    });

    it('reports UNRESOLVED as itself to the customer, and only to that customer', async () => {
      const { user } = await createCustomer(prisma);
      const { user: stranger } = await createCustomer(prisma);
      const { topUpId } = await pendingSince(user.id, 45);
      await balance.escalateStaleTopUps();

      expect(await balance.getTopUpStatus(user.id, topUpId)).toMatchObject({
        topUpId,
        status: 'UNRESOLVED',
        amount: '5000.0000',
        resolvedAt: null,
      });
      await expect(balance.getTopUpStatus(stranger.id, topUpId)).rejects.toThrow(/not found/i);
    });
  });
});
