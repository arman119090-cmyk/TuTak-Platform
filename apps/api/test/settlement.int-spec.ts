import { LedgerAccountType, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { SettlementService } from '../src/modules/settlement/settlement.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Phase 4: settlement, and the reason its timing matters.
 *
 * Bonus accrual happens here rather than at capture, so that points earned on
 * a payment which is later refunded were never issued — instead of being
 * issued and clawed back from a customer who may already have spent them.
 * These tests pin that ordering down, along with the idempotency the outbox's
 * at-least-once delivery demands.
 */
describe('SettlementService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let settlement: SettlementService;
  let outbox: OutboxService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    settlement = harness.app.get(SettlementService);
    outbox = harness.app.get(OutboxService);
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

  const balanceOf = async (type: LedgerAccountType): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({ where: { type, partnerId: null } });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  it('accrues bonus at the partner rate and records the settlement', async () => {
    const { user, wallet } = await createCustomer(prisma);
    // 500bps = 5% of 10,000 = 500 points.
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

    const payment = await capture(user.id, partner.id, '10000', 'pay-settle-1');
    const result = await settlement.settlePayment(payment.paymentId);

    expect(result.claimed).toBe(true);
    expect(result.bonusAccrued).toBe('500.0000');

    const stored = await prisma.settlement.findUniqueOrThrow({ where: { id: result.settlementId } });
    expect(stored.grossAmount.toFixed(4)).toBe('10000.0000');
    expect(stored.commissionAmount.toFixed(4)).toBe('250.0000');
    expect(stored.netAmount.toFixed(4)).toBe('9750.0000');
    expect(stored.paymentCount).toBe(1);

    const settledPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.paymentId },
    });
    expect(settledPayment.settlementId).toBe(result.settlementId);
    expect(settledPayment.accruedLotId).not.toBeNull();

    // The customer actually has the points.
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.lifetimeEarned.toFixed(4)).toBe('500.0000');
  });

  it('records issued points as a liability, not as retained revenue', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

    const payment = await capture(user.id, partner.id, '10000', 'pay-liability-1');
    await settlement.settlePayment(payment.paymentId);

    // Capture credited 250 revenue; settlement then debited 500 of it as the
    // cost of the points issued, leaving the platform 250 in the red on this
    // transaction — which is the truth: it gave away more than it took.
    // Credit-normal accounts read negative, so revenue of -250 + 500 = +250.
    expect(await balanceOf(LedgerAccountType.PLATFORM_REVENUE)).toBe('250.0000');
    expect(await balanceOf(LedgerAccountType.BONUS_LIABILITY)).toBe('-500.0000');
  });

  it('batches several payments from the same partner into one day', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

    const first = await capture(user.id, partner.id, '4000', 'pay-batch-1');
    const second = await capture(user.id, partner.id, '6000', 'pay-batch-2');

    const a = await settlement.settlePayment(first.paymentId);
    const b = await settlement.settlePayment(second.paymentId);

    expect(a.settlementId).toBe(b.settlementId);
    expect(await prisma.settlement.count()).toBe(1);

    const stored = await prisma.settlement.findUniqueOrThrow({ where: { id: a.settlementId } });
    expect(stored.grossAmount.toFixed(4)).toBe('10000.0000');
    expect(stored.paymentCount).toBe(2);
    expect(stored.bonusAccrued.toFixed(4)).toBe('500.0000');
  });

  it('keeps separate partners in separate settlements', async () => {
    const { user } = await createCustomer(prisma);
    const partnerA = await createPartner(prisma, { displayName: 'A' });
    const partnerB = await createPartner(prisma, { displayName: 'B' });

    const first = await capture(user.id, partnerA.id, '1000', 'pay-sep-a');
    const second = await capture(user.id, partnerB.id, '1000', 'pay-sep-b');

    const a = await settlement.settlePayment(first.paymentId);
    const b = await settlement.settlePayment(second.paymentId);

    expect(a.settlementId).not.toBe(b.settlementId);
    expect(await prisma.settlement.count()).toBe(2);
  });

  // ── Idempotency, which at-least-once delivery makes mandatory ──────────

  it('accrues exactly once when the same event is delivered twice', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

    const payment = await capture(user.id, partner.id, '10000', 'pay-redeliver-1');
    const first = await settlement.settlePayment(payment.paymentId);
    const second = await settlement.settlePayment(payment.paymentId);

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.bonusAccrued).toBe('0');

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.lifetimeEarned.toFixed(4)).toBe('500.0000');
    expect(await prisma.bonusLot.count({ where: { walletId: wallet.id } })).toBe(1);
  });

  it('settles exactly once when two workers race the same payment', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-race-settle');

    const results = await Promise.allSettled([
      settlement.settlePayment(payment.paymentId),
      settlement.settlePayment(payment.paymentId),
    ]);

    const claimed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.claimed,
    );
    expect(claimed).toHaveLength(1);

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.lifetimeEarned.toFixed(4)).toBe('500.0000');
  });

  // ── Business rules ────────────────────────────────────────────────────

  it('settles the money but withholds points from an unverified account', async () => {
    // Unverified accounts can pay — that costs them money. What they cannot
    // do is earn, which is the only direction a fabricated account is
    // profitable in. Settlement must still complete: the partner is owed
    // their money regardless of the customer's verification state.
    const { user, wallet } = await createCustomer(prisma, { isPhoneVerified: false });
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

    const payment = await capture(user.id, partner.id, '10000', 'pay-unverified-1');
    const result = await settlement.settlePayment(payment.paymentId);

    expect(result.claimed).toBe(true);
    expect(result.bonusAccrued).toBe('0.0000');

    const stored = await prisma.settlement.findUniqueOrThrow({ where: { id: result.settlementId } });
    expect(stored.grossAmount.toFixed(4)).toBe('10000.0000');

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.lifetimeEarned.toFixed(4)).toBe('0.0000');
  });

  it('has nothing to settle for a declined payment', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);

    const declined = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '5000',
      sourceToken: 'tok_decline_generic',
      idempotencyKey: 'pay-declined-settle',
    });

    const result = await settlement.settlePayment(declined.paymentId);
    expect(result.claimed).toBe(false);
    expect(await prisma.settlement.count()).toBe(0);
  });

  // ── Wired to the outbox, not just callable ────────────────────────────

  it('settles a captured payment when the outbox drains, end to end', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });

    // capture() writes payment.captured to the outbox in the same
    // transaction as the ledger postings; nothing has drained it yet.
    await capture(user.id, partner.id, '10000', 'pay-outbox-settle');
    expect(await prisma.settlement.count()).toBe(0);

    await outbox.drain();

    expect(await prisma.settlement.count()).toBe(1);
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.lifetimeEarned.toFixed(4)).toBe('500.0000');
  });
});
