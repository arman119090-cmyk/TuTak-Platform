import {
  BonusEntryType,
  Currency,
  LedgerAccountType,
  PaymentRoute,
  PostingDirection,
  PrismaClient,
  PspAttemptStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { AcquirerSettlementService } from '../src/modules/payouts/acquirer-settlement.service';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { TreasuryService } from '../src/modules/treasury/treasury.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The cash cycle, end to end, and the difference between owing and having.
 *
 * A capture credits `PSP_RECEIVABLE` — a claim on the provider, not money in
 * the bank. A payout spends `PLATFORM_BANK`. Joining the two is the acquirer
 * settlement: the provider actually remitting. Until that is recorded, a
 * platform that treats the claim as cash is a platform writing cheques
 * against money in transit.
 */
describe('Treasury and acquirer settlement (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;
  let treasury: TreasuryService;
  let acquirer: AcquirerSettlementService;
  let bonusEngine: BonusEngineService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
    treasury = harness.app.get(TreasuryService);
    acquirer = harness.app.get(AcquirerSettlementService);
    bonusEngine = harness.app.get(BonusEngineService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';
  let adminId = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma)).id;
    adminId = (await createStaffUser(prisma)).id;
  });

  /** A purchase paid through the provider, settled into the ledger. */
  async function paidThroughProvider(billId: string, gross = '15000', bonus = '1000') {
    const customer = await createCustomer(prisma);
    if (new Decimal(bonus).greaterThan(0)) {
      await bonusEngine.accrue({
        walletId: customer.wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: bonus,
        pendingHours: 0,
      });
    }
    const intent = await intents.create(
      {
        partnerId,
        grossAmount: gross,
        ...(new Decimal(bonus).greaterThan(0) ? { bonusAmountRequested: bonus } : {}),
        paymentRoute: PaymentRoute.TUTAK_PSP,
      },
      customer.user.id,
    );
    await intents.approveForPayment(intent.id, staffId, {});
    const remainder = new Decimal(gross).minus(bonus);
    await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: remainder,
        providerBillId: billId,
        liveKey: 'live',
      },
    });
    await psp.settleVerifiedConfirmation({
      billId,
      providerTransactionId: `IDRAM-${billId}`,
      amount: remainder,
      raw: {},
    });
    return { intent, remainder };
  }

  const accountBalance = async (type: LedgerAccountType) => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: null, userId: null, currency: Currency.AMD },
    });
    return account?.balance ?? new Decimal(0);
  };

  it('proves the whole chain: captured → receivable → settled → bank', async () => {
    await paidThroughProvider('bill-chain', '15000', '1000');

    // Captured. The provider is holding 14,000; the bank has nothing.
    expect((await accountBalance(LedgerAccountType.PSP_RECEIVABLE)).toFixed(2)).toBe('14000.00');
    const before = await treasury.position();
    expect(before.pspReceivable).toBe('14000.0000');
    expect(before.unsettledAcquirerAmount).toBe('14000.0000');
    expect(before.platformBank).toBe('0.0000');
    // The partner is owed their entitlement already, and the cash for it has
    // not arrived. This is exactly the gap that makes liquidity a separate
    // question from the Net Position.
    expect(new Decimal(before.partnerPayable).greaterThan(0)).toBe(true);
    expect(before.safeToPay).toBe('0.0000');

    // The provider remits, keyed in by a human from the statement.
    await acquirer.record({
      amount: '14000',
      reference: 'IDRAM-REMIT-2026-09-15',
      settledOn: new Date(),
      actorId: adminId,
      idempotencyKey: 'remit-1',
    });

    expect((await accountBalance(LedgerAccountType.PSP_RECEIVABLE)).toFixed(2)).toBe('0.00');
    expect((await accountBalance(LedgerAccountType.PLATFORM_BANK)).toFixed(2)).toBe('14000.00');

    const after = await treasury.position();
    expect(after.pspReceivable).toBe('0.0000');
    expect(after.platformBank).toBe('14000.0000');
    // Only now is there money that could fund a transfer.
    expect(after.safeToPay).toBe('14000.0000');
  });

  it('will not let one remittance be recorded twice', async () => {
    await paidThroughProvider('bill-dupe', '15000', '0');

    await acquirer.record({
      amount: '15000',
      reference: 'IDRAM-REMIT-DUP',
      settledOn: new Date(),
      actorId: adminId,
      idempotencyKey: 'remit-dup-1',
    });

    // Same statement line, keyed in again by somebody who did not know it
    // was already done. The reference is unique per currency, so the second
    // attempt cannot conjure a second 15,000 into the bank.
    await expect(
      acquirer.record({
        amount: '15000',
        reference: 'IDRAM-REMIT-DUP',
        settledOn: new Date(),
        actorId: adminId,
        idempotencyKey: 'remit-dup-2',
      }),
    ).rejects.toThrow();

    expect((await accountBalance(LedgerAccountType.PLATFORM_BANK)).toFixed(2)).toBe('15000.00');
  });

  it('counts an unresolved payment against what is safe to pay', async () => {
    // Money in the bank from an earlier, settled purchase.
    await paidThroughProvider('bill-settled', '10000', '0');
    await acquirer.record({
      amount: '10000',
      reference: 'IDRAM-REMIT-EARLIER',
      settledOn: new Date(),
      actorId: adminId,
      idempotencyKey: 'remit-earlier',
    });
    expect((await treasury.position()).safeToPay).toBe('10000.0000');

    // And a payment nobody can account for. It may have succeeded, and if it
    // did, that money becomes a partner's the moment it resolves.
    const customer = await createCustomer(prisma);
    const pending = await intents.create(
      { partnerId, grossAmount: '4000', paymentRoute: PaymentRoute.TUTAK_PSP },
      customer.user.id,
    );
    await intents.approveForPayment(pending.id, staffId, {});
    await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: pending.id,
        provider: 'idram',
        status: PspAttemptStatus.EXPIRED,
        amount: new Decimal('4000'),
        providerBillId: 'bill-unknown',
        resolvedAt: new Date(),
      },
    });

    const position = await treasury.position();
    expect(position.pendingPspExposure).toBe('4000.0000');
    expect(position.safeToPay).toBe('6000.0000');
  });

  it('reports unknown provider fees as unknown, never as zero', async () => {
    await paidThroughProvider('bill-fee', '15000', '0');

    const position = await treasury.position();
    // Idram's documentation does not establish a fee statement, so a
    // captured payment carries no fee figure. Saying "one payment whose fee
    // we do not know" is honest; booking it at zero would overstate what the
    // platform can pay out by exactly the fees.
    expect(position.paymentsWithUnknownFee).toBe(1);
    const attempt = await prisma.pspPaymentAttempt.findFirstOrThrow({
      where: { providerBillId: 'bill-fee' },
    });
    expect(attempt.providerFeeAmount).toBeNull();
  });

  it('keeps a partner who owes us from funding a partner we owe', async () => {
    // One partner in credit.
    await paidThroughProvider('bill-credit', '15000', '0');

    // Another in debit — a refund reversed more than they had accrued.
    const debtor = await createPartner(prisma, { displayName: 'In debt' });
    const [payable, revenue] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: debtor.id }),
      ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }),
    ]);
    await ledger.post({
      kind: 'partner.contribution',
      sourceType: 'Test',
      sourceId: 'debt-1',
      postings: [
        { accountId: payable.id, direction: PostingDirection.DEBIT, amount: new Decimal('2000') },
        { accountId: revenue.id, direction: PostingDirection.CREDIT, amount: new Decimal('2000') },
      ],
    });

    const position = await treasury.position();
    // Reported separately, not netted: 2,000 owed *to* the platform does not
    // pay a different partner their 14,500.
    expect(new Decimal(position.partnerPayable).greaterThan(0)).toBe(true);
    expect(position.partnerReceivable).toBe('2000.0000');
  });
});
