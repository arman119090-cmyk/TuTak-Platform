import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RefundEngineService } from '../src/modules/payments/refund-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * A refund that leaves the partner owing the platform.
 *
 * The sequence is ordinary and nobody had written it down: a partner earns,
 * the platform pays them out, and only then is the customer refunded. The
 * refund debits a payable the payout already emptied, so the account crosses
 * zero and the platform is out of pocket until the partner pays it back.
 *
 * Nothing is broken by this. The ledger balances, the postings are right,
 * and a payout request is refused while the balance is against them. What
 * was missing is that nobody found out — and money outside the platform
 * that only a person can retrieve is a write-off if that person never hears
 * about it.
 *
 * Found by `money-sequence-fuzz.int-spec.ts`, which proposed the ordering on
 * its own. Three of twenty seeds produced it; no hand-written test had.
 */
describe('A refund that puts a partner in debit (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let refunds: RefundEngineService;
  let payouts: PayoutEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    refunds = harness.app.get(RefundEngineService);
    payouts = harness.app.get(PayoutEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await harness.resetAlerts();
    jest.restoreAllMocks();
  });

  /** Earn, pay the partner everything, then refund the customer. */
  const drainThenRefund = async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const operator = await createCustomer(prisma);

    const payment = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000.00',
      sourceToken: 'tok_ok',
      idempotencyKey: 'debit-capture',
    });

    // Everything the partner is owed, out the door.
    const owed = await payouts.availableBalance(partner.id);
    await payouts.requestPayout({
      partnerId: partner.id,
      amount: owed.toFixed(4),
      actorId: operator.user.id,
      idempotencyKey: 'debit-payout',
    });

    await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'customer disputed the charge',
      actorId: operator.user.id,
      idempotencyKey: 'debit-refund',
    });

    return { partner, operator, owed };
  };

  it('tells somebody the partner now owes the platform', async () => {
    const { partner } = await drainThenRefund();

    const alerts = harness.alerts.sent;
    const debt = alerts.find((a) => a.key === `partner.in-debit:${partner.id}`);

    expect(debt).toBeDefined();
    expect(debt?.severity).toBe('warning');
    expect(debt?.body).toContain('owes');
    expect(debt?.context?.partnerId).toBe(partner.id);
    expect(new Decimal(String(debt?.context?.owed ?? 0)).greaterThan(0)).toBe(true);
  });

  it('refuses to pay the partner again while the balance is against them', async () => {
    const { partner, operator } = await drainThenRefund();

    await expect(
      payouts.requestPayout({
        partnerId: partner.id,
        amount: '1.00',
        actorId: operator.user.id,
        idempotencyKey: 'debit-second-payout',
      }),
    ).rejects.toThrow(/exceeds/i);
  });

  it('leaves the ledger balanced and the debt no larger than what was paid out', async () => {
    const { partner, owed } = await drainThenRefund();

    const [totals] = await prisma.$queryRaw<{ difference: Decimal }[]>`
      select coalesce(sum(case when direction = 'DEBIT' then amount else -amount end), 0)
        as difference from ledger_postings
    `;
    expect(new Decimal(totals?.difference ?? 0).toFixed(4)).toBe('0.0000');

    const account = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    // The partner owes something, and never more than the platform sent them.
    expect(new Decimal(account.balance).greaterThan(0)).toBe(true);
    expect(new Decimal(account.balance).lessThanOrEqualTo(owed)).toBe(true);
  });

  it('says nothing when the refund leaves the partner still owed money', async () => {
    // The ordinary case, and the one that must not generate noise: a refund
    // against a balance the partner has not been paid out yet.
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const operator = await createCustomer(prisma);

    const payment = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000.00',
      sourceToken: 'tok_ok',
      idempotencyKey: 'quiet-capture',
    });
    await refunds.refund({
      paymentId: payment.paymentId,
      amount: '100.00',
      reason: 'partial',
      actorId: operator.user.id,
      idempotencyKey: 'quiet-refund',
    });

    const alerts = harness.alerts.sent;
    expect(alerts.find((a) => a.key === `partner.in-debit:${partner.id}`)).toBeUndefined();
  });
});
