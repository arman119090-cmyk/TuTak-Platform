import { ConflictException } from '@nestjs/common';
import { LedgerAccountType, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { AcquirerSettlementService } from '../src/modules/payouts/acquirer-settlement.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The acquirer paying the platform.
 *
 * Two properties carry the weight. The first is that this closes a loop that
 * was previously open at one end: before it, PSP_RECEIVABLE only ever grew
 * and PLATFORM_BANK only ever shrank, so a full cycle — capture, settle,
 * pay the partner, get paid by the acquirer — could not return either
 * account to a sensible place. The second is that the platform cannot be
 * told it received more than the acquirer holds, because that is not a
 * clerical error to absorb, it is the two sides disagreeing about what was
 * captured.
 */
describe('AcquirerSettlementService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let payouts: PayoutEngineService;
  let acquirer: AcquirerSettlementService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    payouts = harness.app.get(PayoutEngineService);
    acquirer = harness.app.get(AcquirerSettlementService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const capture = async (partnerId: string, amount: string, key: string) => {
    const { user } = await createCustomer(prisma);
    return payments.capture({
      userId: user.id,
      partnerId,
      amount,
      sourceToken: 'tok_visa_test',
      idempotencyKey: key,
    });
  };

  const balanceOf = async (type: LedgerAccountType, partnerId?: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: partnerId ?? null },
    });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  const assertLedgerIntegrity = async () => {
    let total = new Decimal(0);
    for (const account of await prisma.ledgerAccount.findMany()) {
      total = total.plus(account.balance);
      const replayed = await ledger.replayBalance(account.id);
      expect({ id: account.id, balance: account.balance.toFixed(4) }).toEqual({
        id: account.id,
        balance: replayed.toFixed(4),
      });
    }
    expect(total.toFixed(4)).toBe('0.0000');
  };

  const settle = (amount: string, reference: string, key: string) =>
    acquirer.record({
      amount,
      reference,
      settledOn: new Date('2026-08-08T00:00:00Z'),
      actorId: 'admin-1',
      idempotencyKey: key,
    });

  it('moves the receivable into the platform bank account', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '10000', 'pay-acq-1');
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('10000.0000');

    const result = await settle('10000', 'REMIT-001', 'acq-1');

    expect(result.amount).toBe('10000.0000');
    expect(result.outstandingReceivable).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('0.0000');
    // Debit-normal: cash the platform holds is positive.
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('10000.0000');
    await assertLedgerIntegrity();
  });

  it('accepts a partial remittance and leaves the rest outstanding', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '10000', 'pay-acq-partial');

    const result = await settle('4000', 'REMIT-002', 'acq-partial');

    expect(result.outstandingReceivable).toBe('6000.0000');
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('6000.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('4000.0000');
    await assertLedgerIntegrity();
  });

  it('refuses a remittance larger than the acquirer holds', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '5000', 'pay-acq-over');

    // Not a rounding difference to absorb: the two sides disagree about what
    // was captured, and posting it would drive the receivable negative and
    // bury the disagreement.
    await expect(settle('5001', 'REMIT-003', 'acq-over')).rejects.toThrow(ConflictException);

    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('5000.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('0.0000');
    expect(await prisma.acquirerSettlement.count()).toBe(0);
    await assertLedgerIntegrity();
  });

  it('refuses the same statement reference twice', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '10000', 'pay-acq-dup');
    await settle('1000', 'REMIT-DUP', 'acq-dup-1');

    // Two operators working from the same remittance email is the realistic
    // way this happens, and neither of them is retrying a request — so the
    // idempotency key differs and the database constraint is what catches it.
    await expect(settle('1000', 'REMIT-DUP', 'acq-dup-2')).rejects.toThrow();

    expect(await prisma.acquirerSettlement.count()).toBe(1);
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('1000.0000');
    await assertLedgerIntegrity();
  });

  it('replays the stored result on a retried idempotency key', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '10000', 'pay-acq-replay');

    const first = await settle('2500', 'REMIT-REPLAY', 'acq-replay');
    const replay = await settle('2500', 'REMIT-REPLAY', 'acq-replay');

    expect(replay.settlementId).toBe(first.settlementId);
    expect(await prisma.acquirerSettlement.count()).toBe(1);
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('2500.0000');
  });

  it('never lets concurrent remittances together exceed the receivable', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '10000', 'pay-acq-race');

    // Both read a receivable of 10,000 if they are allowed to read it at the
    // same time; the FOR UPDATE lock is what makes the second one re-read.
    const results = await Promise.allSettled([
      settle('7000', 'REMIT-RACE-A', 'acq-race-a'),
      settle('7000', 'REMIT-RACE-B', 'acq-race-b'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('7000.0000');
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('3000.0000');
    await assertLedgerIntegrity();
  });

  it('records the posting against the settlement it belongs to', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '10000', 'pay-acq-trace');
    const result = await settle('3000', 'REMIT-TRACE', 'acq-trace');

    const stored = await prisma.acquirerSettlement.findUniqueOrThrow({
      where: { id: result.settlementId },
    });
    expect(stored.ledgerTransactionId).not.toBeNull();
    expect(stored.recordedByUserId).toBe('admin-1');

    const transaction = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: stored.ledgerTransactionId! },
      include: { postings: true },
    });
    expect(transaction.kind).toBe('acquirer.settled');
    expect(transaction.sourceId).toBe(result.settlementId);
  });

  // ── The loop that could not close before ──────────────────────────────

  it('returns both accounts to zero across a full cash cycle', async () => {
    const partner = await createPartner(prisma);
    await capture(partner.id, '10000', 'pay-acq-cycle');

    // The acquirer pays the platform everything it captured.
    await settle('10000', 'REMIT-CYCLE', 'acq-cycle');

    // The platform pays the partner everything it owes them, and the bank
    // confirms the transfer.
    const owed = await payouts.availableBalance(partner.id);
    const payout = await payouts.requestPayout({
      partnerId: partner.id,
      amount: owed.toFixed(4),
      actorId: 'admin-1',
      idempotencyKey: 'acq-cycle-payout',
    });
    await payouts.confirmPaid(payout.payoutId, 'BANK-CYCLE');

    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
    // What the platform keeps is its commission, and it is sitting in the
    // bank rather than in a receivable. Before this service existed the same
    // cycle left PSP_RECEIVABLE at 10,000 and PLATFORM_BANK at -9,750.
    const revenue = await balanceOf(LedgerAccountType.PLATFORM_REVENUE);
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe(
      new Decimal(revenue).negated().toFixed(4),
    );
    await assertLedgerIntegrity();
  });
});
