import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { LedgerAccountType, PayoutStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Payouts.
 *
 * One property dominates: a partner can never be paid more than they are
 * owed. The interesting case is two admins requesting payouts against the
 * same balance at the same instant — a check-then-act would let both through,
 * which is why the balance is read under `FOR UPDATE` inside the transaction
 * that spends it.
 */
describe('PayoutEngineService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let payouts: PayoutEngineService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    payouts = harness.app.get(PayoutEngineService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Earns a partner a payable balance by putting real payments through. */
  const earn = async (partnerId: string, amount: string, key: string) => {
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
    for (const account of await prisma.ledgerAccount.findMany()) {
      const replayed = await ledger.replayBalance(account.id);
      expect({ id: account.id, balance: account.balance.toFixed(4) }).toEqual({
        id: account.id,
        balance: replayed.toFixed(4),
      });
    }
  };

  it('reports what a partner is owed as a positive figure', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-balance-1');

    // Stored credit-normal as -9,750; a partner asking "what am I owed?"
    // should not have to know that.
    expect((await payouts.availableBalance(partner.id)).toFixed(4)).toBe('9750.0000');
  });

  it('moves the money out of payable and into clearing', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-1');

    const result = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '9750',
      actorId: 'admin-1',
      idempotencyKey: 'payout-1',
    });

    expect(result.status).toBe(PayoutStatus.REQUESTED);
    expect(result.amount).toBe('9750.0000');
    expect(result.remainingBalance).toBe('0.0000');

    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('-9750.0000');
    await assertLedgerIntegrity();
  });

  it('allows a partial payout and leaves the remainder available', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-partial');

    const result = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '5000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-partial-1',
    });

    expect(result.remainingBalance).toBe('4750.0000');
    await assertLedgerIntegrity();
  });

  // ── Never pay out more than is owed ───────────────────────────────────

  it('refuses a payout larger than the available balance', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '1000', 'pay-payout-over');

    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '50000',
        actorId: 'admin-1',
        idempotencyKey: 'payout-over-1',
      }),
    ).rejects.toThrow(ConflictException);

    expect(await prisma.payout.count()).toBe(0);
    await assertLedgerIntegrity();
  });

  it('refuses a payout against a partner who has earned nothing', async () => {
    const partner = await createPartner(prisma);

    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '100',
        actorId: 'admin-1',
        idempotencyKey: 'payout-empty-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('never lets concurrent payouts together exceed the balance', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-race');
    // 9,750 available; two requests for 6,000 cannot both be honoured.

    const results = await Promise.allSettled([
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '6000',
        actorId: 'admin-1',
        idempotencyKey: 'payout-race-a',
      }),
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '6000',
        actorId: 'admin-2',
        idempotencyKey: 'payout-race-b',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.payout.count()).toBe(1);

    // Whatever happened, the partner is not overdrawn.
    const remaining = await payouts.availableBalance(partner.id);
    expect(remaining.isNegative()).toBe(false);
    expect(remaining.toFixed(4)).toBe('3750.0000');
    await assertLedgerIntegrity();
  });

  it('lets several sequential payouts drain a balance exactly, and no further', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-drain');

    await payouts.requestPayout({
      partnerId: partner.id,
      amount: '5000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-drain-1',
    });
    await payouts.requestPayout({
      partnerId: partner.id,
      amount: '4750',
      actorId: 'admin-1',
      idempotencyKey: 'payout-drain-2',
    });

    expect((await payouts.availableBalance(partner.id)).toFixed(4)).toBe('0.0000');

    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '1',
        actorId: 'admin-1',
        idempotencyKey: 'payout-drain-3',
      }),
    ).rejects.toThrow(ConflictException);
  });

  // ── The two-person rule ───────────────────────────────────────────────
  //
  // Requesting a payout moves a partner's money into BANK_CLEARING;
  // confirming it asserts the bank really sent it. One person doing both is
  // enough to drain a partner and mark the theft settled, with every record
  // left behind agreeing it was legitimate.

  it('refuses a confirmation from the person who requested the payout', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-dual-1');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '5000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-dual-1',
    });

    await expect(
      payouts.confirmPaid(requested.payoutId, 'BANK-SELF', 'admin-1'),
    ).rejects.toThrow(ForbiddenException);

    // And nothing moved: the refusal has to happen before the ledger does,
    // or the control is decorative.
    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: requested.payoutId } });
    expect(stored.status).toBe(PayoutStatus.REQUESTED);
    expect(stored.confirmedByUserId).toBeNull();
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('-5000.0000');
  });

  it('records who confirmed, so the rule is auditable afterwards', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-dual-2');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '5000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-dual-2',
    });

    await payouts.confirmPaid(requested.payoutId, 'BANK-OK', 'admin-2');

    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: requested.payoutId } });
    // Both names on the row the money moved through. An audit log can be
    // argued with; this cannot.
    expect(stored.requestedByUserId).toBe('admin-1');
    expect(stored.confirmedByUserId).toBe('admin-2');
    expect(stored.status).toBe(PayoutStatus.PAID);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  it('closes a payout when the bank confirms it', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-confirm');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '9750',
      actorId: 'admin-1',
      idempotencyKey: 'payout-confirm-1',
    });

    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('-9750.0000');

    await payouts.confirmPaid(requested.payoutId, 'BANK-REF-123', 'admin-2');

    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: requested.payoutId } });
    expect(stored.status).toBe(PayoutStatus.PAID);
    expect(stored.bankReference).toBe('BANK-REF-123');
    expect(stored.completedAt).not.toBeNull();

    // The point of the clearing account: it answers "what is moving right
    // now", so a settled transfer must leave it. It used to stay, which made
    // a confirmed payout indistinguishable from a stuck one.
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('-9750.0000');
    await assertLedgerIntegrity();
  });

  it('records the settlement posting against the payout it settled', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-trace');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '2000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-trace-1',
    });
    await payouts.confirmPaid(requested.payoutId, 'BANK-REF-TRACE', 'admin-2');

    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: requested.payoutId } });
    // Both halves are traceable: money leaving the partner's balance, and
    // money leaving the platform's bank.
    expect(stored.ledgerTransactionId).not.toBeNull();
    expect(stored.settlementLedgerTransactionId).not.toBeNull();
    expect(stored.settlementLedgerTransactionId).not.toBe(stored.ledgerTransactionId);

    const settlement = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: stored.settlementLedgerTransactionId! },
      include: { postings: true },
    });
    expect(settlement.kind).toBe('payout.settled');
    expect(settlement.sourceId).toBe(requested.payoutId);
    const net = settlement.postings.reduce(
      (acc, p) => acc + (p.direction === 'DEBIT' ? 1 : -1) * Number(p.amount),
      0,
    );
    expect(net).toBe(0);
  });

  it('leaves clearing at zero and the bank untouched when a payout fails instead', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-nobank');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '3000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-nobank-1',
    });

    await payouts.markFailed(requested.payoutId, 'account closed');

    // Failure reverses the request. No money ever left the platform, so the
    // bank account must have nothing to say about it.
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('0.0000');
    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: requested.payoutId } });
    expect(stored.settlementLedgerTransactionId).toBeNull();
    await assertLedgerIntegrity();
  });

  it('does not double-drain clearing when a confirmation is retried', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-retry');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '5000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-retry-1',
    });

    await payouts.confirmPaid(requested.payoutId, 'BANK-REF-A', 'admin-2');
    await expect(
      payouts.confirmPaid(requested.payoutId, 'BANK-REF-B', 'admin-2'),
    ).rejects.toThrow();

    // The refused second confirmation must not have posted anything: the
    // claim and the posting share a transaction precisely so that a rejected
    // claim rolls the posting back with it.
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('-5000.0000');
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'payout.settled' } })).toBe(1);
    await assertLedgerIntegrity();
  });

  it('returns the money to the partner when the bank rejects the transfer', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-fail');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '9750',
      actorId: 'admin-1',
      idempotencyKey: 'payout-fail-1',
    });
    expect((await payouts.availableBalance(partner.id)).toFixed(4)).toBe('0.0000');

    await payouts.markFailed(requested.payoutId, 'account closed');

    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: requested.payoutId } });
    expect(stored.status).toBe(PayoutStatus.FAILED);
    // Reversed, not edited — the money is available again and the clearing
    // account is back to zero.
    expect((await payouts.availableBalance(partner.id)).toFixed(4)).toBe('9750.0000');
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('0.0000');
    await assertLedgerIntegrity();
  });

  it('refuses to resolve the same payout twice', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-twice');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: '1000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-twice-1',
    });

    await payouts.confirmPaid(requested.payoutId, 'BANK-REF-1', 'admin-2');
    await expect(payouts.confirmPaid(requested.payoutId, 'BANK-REF-2', 'admin-2')).rejects.toThrow(
      BadRequestException,
    );
    await expect(payouts.markFailed(requested.payoutId, 'too late')).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── Guards ────────────────────────────────────────────────────────────

  it('refuses a payout to a deactivated partner', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-inactive');
    await prisma.partner.update({ where: { id: partner.id }, data: { isActive: false } });

    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '1000',
        actorId: 'admin-1',
        idempotencyKey: 'payout-inactive-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a payout while reconciliation has the partner blocked', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-blocked');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { payoutsBlockedAt: new Date(), payoutsBlockedReason: 'drift under investigation' },
    });

    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '1000',
        actorId: 'admin-1',
        idempotencyKey: 'payout-blocked-1',
      }),
    ).rejects.toThrow(/drift under investigation/);

    expect(await prisma.payout.count()).toBe(0);
  });

  it('replays the stored result on a retried idempotency key', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-payout-idem');
    const request = {
      partnerId: partner.id,
      amount: '1000',
      actorId: 'admin-1',
      idempotencyKey: 'payout-idem-1',
    };

    const first = await payouts.requestPayout(request);
    const second = await payouts.requestPayout(request);

    expect(second).toEqual(first);
    expect(await prisma.payout.count()).toBe(1);
    expect((await payouts.availableBalance(partner.id)).toFixed(4)).toBe('8750.0000');
  });
});
