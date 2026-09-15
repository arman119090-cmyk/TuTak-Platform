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

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    balance = harness.app.get(CustomerBalanceService);
    adapter = harness.app.get<BankTopUpAdapter>(BANK_TOPUP_ADAPTER);
  });

  afterAll(async () => {
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
});
