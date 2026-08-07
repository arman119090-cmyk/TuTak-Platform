import { BadRequestException, ConflictException } from '@nestjs/common';
import { BonusLotStatus, LedgerAccountType, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RefundEngineService } from '../src/modules/payments/refund-engine.service';
import { SettlementService } from '../src/modules/settlement/settlement.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Refunds.
 *
 * The attack this file is written against is the oldest one in payments:
 * refund the same charge more than once, or refund more than was charged, and
 * walk away with the difference. The defence is layered — a conditional
 * UPDATE in the engine, and a CHECK constraint under it — and both layers are
 * tested, including the case where the first is raced.
 *
 * The second theme is that money and points must reverse together: a refunded
 * purchase that leaves its loyalty points outstanding is a free-points
 * machine (buy, earn, refund, keep).
 */
describe('RefundEngineService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let refunds: RefundEngineService;
  let settlement: SettlementService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    refunds = harness.app.get(RefundEngineService);
    settlement = harness.app.get(SettlementService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const capture = async (userId: string, partnerId: string, amount: string, key: string) =>
    payments.capture({
      userId,
      partnerId,
      amount,
      sourceToken: 'tok_visa_test',
      idempotencyKey: key,
    });

  const balanceOf = async (type: LedgerAccountType, partnerId?: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: partnerId ?? null },
    });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  /** Every account's materialized balance must equal a replay of its postings. */
  const assertLedgerIntegrity = async () => {
    for (const account of await prisma.ledgerAccount.findMany()) {
      const replayed = await ledger.replayBalance(account.id);
      expect({ id: account.id, balance: account.balance.toFixed(4) }).toEqual({
        id: account.id,
        balance: replayed.toFixed(4),
      });
    }
  };

  // ── The happy paths ───────────────────────────────────────────────────

  it('reverses the full payment and leaves every account back at zero', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-refund-full');

    const result = await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'customer changed their mind',
      actorId: 'admin-1',
      idempotencyKey: 'refund-full-1',
    });

    expect(result.amount).toBe('10000.0000');
    expect(result.totalRefunded).toBe('10000.0000');

    // Capture then full refund is a no-op in aggregate.
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_REVENUE)).toBe('0.0000');
    await assertLedgerIntegrity();
  });

  it('refunds the commission in proportion on a partial refund', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-refund-partial');

    // Half back: the partner should not absorb a full fee on money they only
    // half kept.
    await refunds.refund({
      paymentId: payment.paymentId,
      amount: '5000',
      reason: 'partial return',
      actorId: 'admin-1',
      idempotencyKey: 'refund-partial-1',
    });

    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('5000.0000');
    // 9,750 owed less 4,875 reversed.
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('-4875.0000');
    // 250 earned less 125 given back.
    expect(await balanceOf(LedgerAccountType.PLATFORM_REVENUE)).toBe('-125.0000');
    await assertLedgerIntegrity();
  });

  it('accumulates several partial refunds up to the captured amount', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-refund-multi');

    for (const [i, amount] of ['3000', '3000', '4000'].entries()) {
      const result = await refunds.refund({
        paymentId: payment.paymentId,
        amount,
        reason: `instalment ${i}`,
        actorId: 'admin-1',
        idempotencyKey: `refund-multi-${i}`,
      });
      expect(result.amount).toBe(new Decimal(amount).toFixed(4));
    }

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(stored.refundedAmount.toFixed(4)).toBe('10000.0000');
    expect(await prisma.refund.count()).toBe(3);
    await assertLedgerIntegrity();
  });

  // ── Over-refunding: the attack ────────────────────────────────────────

  it('refuses a refund larger than the captured amount', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '1000', 'pay-over-1');

    await expect(
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '5000',
        reason: 'nice try',
        actorId: 'admin-1',
        idempotencyKey: 'refund-over-1',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(await prisma.refund.count()).toBe(0);
  });

  it('refuses a second refund once the payment is fully refunded', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '1000', 'pay-over-2');

    await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'first',
      actorId: 'admin-1',
      idempotencyKey: 'refund-over-2a',
    });

    await expect(
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '1000',
        reason: 'second',
        actorId: 'admin-1',
        idempotencyKey: 'refund-over-2b',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(await prisma.refund.count()).toBe(1);
  });

  it('never lets concurrent refunds together exceed the captured amount', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '1000', 'pay-race-refund');

    // Both pass the up-front bounds check against the same stale total; only
    // the conditional UPDATE inside can tell them apart.
    const results = await Promise.allSettled([
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '1000',
        reason: 'a',
        actorId: 'admin-1',
        idempotencyKey: 'refund-race-a',
      }),
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '1000',
        reason: 'b',
        actorId: 'admin-2',
        idempotencyKey: 'refund-race-b',
      }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(stored.refundedAmount.toFixed(4)).toBe('1000.0000');
    expect(await prisma.refund.count()).toBe(1);
    await assertLedgerIntegrity();
  });

  it('refuses to over-refund at the database level even with the engine bypassed', async () => {
    // The engine's conditional UPDATE is the first line of defence; this is
    // the second. If a future change loses the guard, or something writes
    // directly, the CHECK constraint still refuses.
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '1000', 'pay-constraint-1');

    await expect(
      prisma.payment.update({
        where: { id: payment.paymentId },
        data: { refundedAmount: new Decimal('1500') },
      }),
    ).rejects.toThrow(/payments_refunded_within_captured/);
  });

  // ── Money and points reverse together ─────────────────────────────────

  it('claws back the points a settled payment issued', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-clawback-1');

    await settlement.settlePayment(payment.paymentId);
    const earned = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(earned.availableBonus.plus(earned.pendingBonus).toFixed(4)).toBe('500.0000');

    const result = await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'returned goods',
      actorId: 'admin-1',
      idempotencyKey: 'refund-clawback-1',
    });

    expect(result.bonusClawedBack).toBe('500.0000');
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.plus(after.pendingBonus).toFixed(4)).toBe('0.0000');
  });

  it('claws back points in proportion on a partial refund', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-clawback-2');
    await settlement.settlePayment(payment.paymentId);

    // Refund 40% → reclaim 40% of the 500 points issued.
    const result = await refunds.refund({
      paymentId: payment.paymentId,
      amount: '4000',
      reason: 'partial return',
      actorId: 'admin-1',
      idempotencyKey: 'refund-clawback-2',
    });

    expect(result.bonusClawedBack).toBe('200.0000');
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.plus(after.pendingBonus).toFixed(4)).toBe('300.0000');
  });

  it('claws back nothing from a payment refunded before it settled', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-clawback-3');

    // Never settled, so no points were ever issued — this is exactly the case
    // settling-after-capture exists to produce.
    const result = await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'cancelled before settlement',
      actorId: 'admin-1',
      idempotencyKey: 'refund-clawback-3',
    });

    expect(result.bonusClawedBack).toBe('0.0000');
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.lifetimeEarned.toFixed(4)).toBe('0.0000');
  });

  it('does not drive a wallet negative when the points were already spent', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-clawback-4');
    await settlement.settlePayment(payment.paymentId);

    // Simulate the lot having cleared its cooling-off window and the customer
    // having spent most of it. Lot status and wallet bucket move together —
    // that is the invariant `promotePendingLots` maintains, and a fixture
    // that broke it would be testing a state the system cannot reach.
    const lot = await prisma.bonusLot.findFirstOrThrow({ where: { walletId: wallet.id } });
    await prisma.bonusLot.update({
      where: { id: lot.id },
      data: { status: BonusLotStatus.AVAILABLE, remainingAmount: new Decimal('100') },
    });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBonus: new Decimal('100'),
        pendingBonus: new Decimal(0),
        lifetimeSpent: new Decimal('400'),
      },
    });

    const result = await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'returned after spending the points',
      actorId: 'admin-1',
      idempotencyKey: 'refund-clawback-4',
    });

    // Only the unspent remainder comes back. Absorbing the difference is a
    // deliberate choice: a negative wallet balance would break every
    // invariant the bonus engine rests on.
    expect(result.bonusClawedBack).toBe('100.0000');
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');
    expect(after.availableBonus.isNegative()).toBe(false);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('replays the stored result on a retried idempotency key', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-refund-idem');
    const request = {
      paymentId: payment.paymentId,
      amount: '3000',
      reason: 'retry me',
      actorId: 'admin-1',
      idempotencyKey: 'refund-idem-1',
    };

    const first = await refunds.refund(request);
    const second = await refunds.refund(request);

    expect(second).toEqual(first);
    expect(await prisma.refund.count()).toBe(1);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(stored.refundedAmount.toFixed(4)).toBe('3000.0000');
  });

  it('rejects a reused idempotency key carrying a different amount', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-refund-mismatch');

    await refunds.refund({
      paymentId: payment.paymentId,
      amount: '1000',
      reason: 'first',
      actorId: 'admin-1',
      idempotencyKey: 'refund-mismatch-1',
    });

    await expect(
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '2000',
        reason: 'first',
        actorId: 'admin-1',
        idempotencyKey: 'refund-mismatch-1',
      }),
    ).rejects.toThrow(ConflictException);

    expect(await prisma.refund.count()).toBe(1);
  });

  it('refuses to refund a declined payment', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const declined = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000',
      sourceToken: 'tok_decline_generic',
      idempotencyKey: 'pay-refund-declined',
    });

    await expect(
      refunds.refund({
        paymentId: declined.paymentId,
        reason: 'refund something that never happened',
        actorId: 'admin-1',
        idempotencyKey: 'refund-declined-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
