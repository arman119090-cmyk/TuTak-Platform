import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RefundEngineService } from '../src/modules/payments/refund-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The same crash window, on the two money paths that are not payments.
 *
 * `payment-key-durability.int-spec.ts` covers capture: the idempotency
 * record is written in a different transaction from the work it protects, so
 * a crash can leave the work committed and its key forgotten, and a retry
 * then does the work again. Capture is now protected by a unique index on
 * the payment itself.
 *
 * `RefundEngineService` and `PayoutEngineService` call the same
 * `IdempotencyService` and carry no such key. Both hand money outward — a
 * duplicated refund pays a customer twice, a duplicated payout pays a
 * partner twice — so the question is not academic.
 *
 * Both have a *bound* that a duplicate cannot exceed: a refund is capped by
 * what remains refundable on the payment, a payout by what the partner is
 * owed. That makes a replay bounded rather than unlimited, which is not the
 * same as safe: an operator who authorised one 500 refund and got two has
 * given away 1,000, and every amount of it was "within bounds".
 */
describe('Refund and payout key durability (integration)', () => {
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

  const capturedPayment = async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const result = await payments.capture({
      userId: user.id,
      partnerId: partner.id,
      amount: '1000.00',
      sourceToken: 'tok_ok',
      idempotencyKey: `cap-${Date.now()}-${Math.random()}`,
    });
    return { user, partner, paymentId: result.paymentId };
  };

  describe('a partial refund whose idempotency record was lost', () => {
    it('does not refund a second time', async () => {
      const { user, paymentId } = await capturedPayment();
      const key = 'refund-lost-record';

      const first = await refunds.refund({
        paymentId,
        amount: '500.00',
        reason: 'customer changed their mind',
        actorId: user.id,
        idempotencyKey: key,
      });

      // The crash window: work committed, the key that remembered it gone.
      const removed = await prisma.idempotencyRecord.deleteMany({ where: { key } });
      expect(removed.count).toBe(1);

      const retry = await refunds.refund({
        paymentId,
        amount: '500.00',
        reason: 'customer changed their mind',
        actorId: user.id,
        idempotencyKey: key,
      });

      expect(retry.refundId).toBe(first.refundId);

      const rows = await prisma.refund.count({ where: { paymentId } });
      expect(rows).toBe(1);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.refundedAmount.toFixed(2)).toBe('500.00');
    });

    // This one passed before the fix as well, which is worth saying out
    // loud: the ledger balanced perfectly while money left twice. Every
    // posting had its counterpart, every account agreed with a replay of
    // itself, and the customer had still been paid 800 on a 400 refund.
    // The amount assertion is what makes it detect the defect rather than
    // merely survive it.
    it('refunds the authorised amount once, and leaves the ledger balanced', async () => {
      const { user, paymentId } = await capturedPayment();
      const key = 'refund-ledger-balance';

      await refunds.refund({
        paymentId,
        amount: '400.00',
        reason: 'partial',
        actorId: user.id,
        idempotencyKey: key,
      });
      await prisma.idempotencyRecord.deleteMany({ where: { key } });
      await refunds.refund({
        paymentId,
        amount: '400.00',
        reason: 'partial',
        actorId: user.id,
        idempotencyKey: key,
      });

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.refundedAmount.toFixed(2)).toBe('400.00');
      await expect(prisma.refund.count({ where: { paymentId } })).resolves.toBe(1);

      const [sums] = await prisma.$queryRaw<{ difference: Decimal }[]>`
        select coalesce(sum(case when direction = 'DEBIT' then amount else -amount end), 0)
          as difference
        from ledger_postings
      `;
      expect(new Decimal(sums?.difference ?? 0).toFixed(4)).toBe('0.0000');
    });
  });

  describe('a payout whose idempotency record was lost', () => {
    it('does not pay the partner a second time', async () => {
      const { partner } = await capturedPayment();
      const key = 'payout-lost-record';

      const { user: operator } = await createCustomer(prisma);
      const first = await payouts.requestPayout({
        partnerId: partner.id,
        amount: '100.00',
        actorId: operator.id,
        idempotencyKey: key,
      });

      const removed = await prisma.idempotencyRecord.deleteMany({ where: { key } });
      expect(removed.count).toBe(1);

      const retry = await payouts.requestPayout({
        partnerId: partner.id,
        amount: '100.00',
        actorId: operator.id,
        idempotencyKey: key,
      });

      expect(retry.payoutId).toBe(first.payoutId);
      await expect(prisma.payout.count({ where: { partnerId: partner.id } })).resolves.toBe(1);
    });
  });
});
