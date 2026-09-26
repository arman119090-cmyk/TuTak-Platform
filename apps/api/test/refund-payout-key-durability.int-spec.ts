import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RefundEngineService } from '../src/modules/payments/refund-engine.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { settlementSupport } from './support/settle';

/**
 * The same crash window, on the two money paths that are not payments.
 *
 * `payment-key-durability.int-spec.ts` covers capture: the idempotency
 * record is written in a different transaction from the work it protects, so
 * a crash can leave the work committed and its key forgotten, and a retry
 * then does the work again. Capture is now protected by a unique index on
 * the payment itself.
 *
 * `RefundEngineService` calls the same `IdempotencyService` and carries no
 * such key. It hands money outward — a duplicated refund pays a customer
 * twice — so the question is not academic. It has a *bound* that a duplicate
 * cannot exceed (what remains refundable on the payment), which makes a
 * replay bounded rather than unlimited, and that is not the same as safe: an
 * operator who authorised one 500 refund and got two has given away 1,000,
 * and every amount of it was "within bounds".
 *
 * The other outward path used to be the legacy payout engine, with the same
 * lost-record window. It was retired on 26.09.2026 (Launch Readiness P1) and
 * a partner is now paid only by `PartnerSettlementService.markPaid`, which
 * needs no idempotency record at all: the claim is a conditional status
 * update inside the transaction that posts, so a retried "paid" — whatever
 * key it carries — finds nothing left to claim and posts nothing. The second
 * describe pins that.
 */
describe('Refund and payout key durability (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let refunds: RefundEngineService;
  let settle: ReturnType<typeof settlementSupport>;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    refunds = harness.app.get(RefundEngineService);
    settle = settlementSupport(harness.app, prisma);
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

  describe('a settlement whose "paid" response was lost', () => {
    it('does not pay the partner a second time when "paid" is retried', async () => {
      const { partner } = await capturedPayment();

      const paid = await settle.payEverything(partner.id, { bankTransferReference: 'BANK-LOST-1' });
      expect(paid.status).toBe('PAID');

      // The operator never saw the response and presses "paid" again, with
      // the same reference and with a different one. Neither pays.
      const checker = await createCustomer(prisma);
      for (const reference of ['BANK-LOST-1', 'BANK-LOST-2']) {
        await expect(
          settle.engine.markPaid(paid.id, { actorId: checker.user.id, bankTransferReference: reference }),
        ).rejects.toThrow(/Settlement is PAID/);
      }

      await expect(
        prisma.ledgerTransaction.count({
          where: { kind: 'partner.settlement.paid', sourceType: 'PartnerSettlement', sourceId: paid.id },
        }),
      ).resolves.toBe(1);
      const payable = await prisma.ledgerAccount.findFirstOrThrow({
        where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
      });
      expect(payable.balance.toFixed(4)).toBe('0.0000');
      const stored = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: paid.id } });
      expect(stored.bankTransferReference).toBe('BANK-LOST-1');

      const [sums] = await prisma.$queryRaw<{ difference: Decimal }[]>`
        select coalesce(sum(case when direction = 'DEBIT' then amount else -amount end), 0)
          as difference
        from ledger_postings
      `;
      expect(new Decimal(sums?.difference ?? 0).toFixed(4)).toBe('0.0000');
    });
  });
});
