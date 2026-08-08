import {
  LedgerAccountType,
  PayoutStatus,
  PostingDirection,
  PrismaClient,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RefundEngineService } from '../src/modules/payments/refund-engine.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { SettlementService } from '../src/modules/settlement/settlement.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Everything a partner is owed, rebuilt from postings alone.
 *
 * The individual engines each have their own suite. What none of them asks is
 * the question a partner's accountant asks, and the one an auditor asks after
 * a dispute: *given only the immutable postings, can every number we show
 * this partner be derived — and does it match what we stored?*
 *
 * That distinction matters because the platform keeps materialized balances
 * for speed. A materialized number that has quietly drifted from its own
 * postings is the worst kind of wrong: it is fast, it is confident, and it is
 * what everybody reads. Reconciliation checks that nightly; this walks a full
 * commercial life — capture, settle, partially refund, pay out — and checks
 * it at the end of the whole journey rather than one operation at a time.
 */
describe('Partner balance reconstruction (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let refunds: RefundEngineService;
  let payouts: PayoutEngineService;
  let settlement: SettlementService;
  let ledger: LedgerService;
  let outbox: OutboxService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    refunds = harness.app.get(RefundEngineService);
    payouts = harness.app.get(PayoutEngineService);
    settlement = harness.app.get(SettlementService);
    ledger = harness.app.get(LedgerService);
    outbox = harness.app.get(OutboxService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Sums the signed postings of an account without reading its stored balance. */
  const replay = async (accountId: string): Promise<Decimal> => {
    const postings = await prisma.ledgerPosting.findMany({
      where: { accountId },
      select: { direction: true, amount: true },
    });
    return postings.reduce(
      (acc, p) =>
        p.direction === PostingDirection.DEBIT ? acc.plus(p.amount) : acc.minus(p.amount),
      new Decimal(0),
    );
  };

  /** Every account's stored balance equals a replay of its own postings. */
  const assertEveryAccountReconstructs = async () => {
    const accounts = await prisma.ledgerAccount.findMany();
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      const replayed = await replay(account.id);
      expect({ account: account.type, balance: account.balance.toString() }).toEqual({
        account: account.type,
        balance: replayed.toString(),
      });
    }
  };

  /** The books balance: every posting is half of a pair that sums to zero. */
  const assertBooksBalance = async () => {
    const sum = await prisma.ledgerAccount.aggregate({ _sum: { balance: true } });
    expect(Number(sum._sum.balance ?? 0)).toBe(0);
  };

  const superAdmin = async (phone: string) => {
    const { user } = await createCustomer(prisma, { phone });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return user;
  };

  it('reconstructs a full commercial life: capture, settle, refund, pay out', async () => {
    const customer = await createCustomer(prisma);
    // 2.5% commission, 5% cashback — deliberately not round, so a rounding
    // step that quietly loses a hundredth shows up in the replay.
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    await prisma.partner.update({
      where: { id: partner.id },
      data: { paymentCommissionRateBps: 250 },
    });

    // ── 1. Three captures ────────────────────────────────────────────────
    const amounts = ['10000', '7333', '1234.5678'];
    for (const [i, amount] of amounts.entries()) {
      await payments.capture({
        userId: customer.user.id,
        partnerId: partner.id,
        amount,
        sourceToken: 'tok_ok',
        idempotencyKey: `recon-capture-${i}`,
      });
    }
    await assertEveryAccountReconstructs();
    await assertBooksBalance();

    // ── 2. Settlement issues the points those captures earned ────────────
    await outbox.drain();
    for (const payment of await prisma.payment.findMany({ where: { partnerId: partner.id } })) {
      await settlement.settlePayment(payment.id);
    }
    await assertEveryAccountReconstructs();
    await assertBooksBalance();

    // ── 3. A partial refund on the largest payment ───────────────────────
    const biggest = await prisma.payment.findFirstOrThrow({
      where: { partnerId: partner.id, amount: '10000' },
    });
    const admin = await superAdmin('+37477830001');
    await refunds.refund({
      paymentId: biggest.id,
      amount: '2500',
      reason: 'partial return',
      actorId: admin.id,
      idempotencyKey: 'recon-refund-1',
    });
    await assertEveryAccountReconstructs();
    await assertBooksBalance();

    // ── 4. What the partner is owed, derived rather than read ────────────
    const payable = await ledger.accountFor({
      type: LedgerAccountType.PARTNER_PAYABLE,
      partnerId: partner.id,
      currency: 'AMD',
    });
    const derived = await replay(payable.id);

    // Payable is credit-normal, so a positive debt is stored negative. What
    // the partner is owed is the amount captured less commission, less the
    // refunded portion and its share of the commission — arrived at here
    // from the postings, not from any field the platform maintains.
    const owed = derived.negated();
    expect(owed.greaterThan(0)).toBe(true);

    const stored = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: payable.id } });
    expect(stored.balance.toString()).toBe(derived.toString());

    // And it agrees with the arithmetic done independently from the payment
    // rows — the same figure reached two different ways.
    const capturedRows = await prisma.payment.findMany({ where: { partnerId: partner.id } });
    const refundRows = await prisma.refund.findMany({
      where: { payment: { partnerId: partner.id } },
      include: { payment: true },
    });
    const grossNet = capturedRows.reduce(
      (acc, p) => acc.plus(p.amount).minus(p.commissionAmount),
      new Decimal(0),
    );
    // The partner's share of a refund is the refunded amount less the
    // proportional slice of commission returned with it — the same
    // apportionment the refund engine posts, recomputed here independently.
    const refundedNet = refundRows.reduce((acc, r) => {
      const commissionShare = r.payment.commissionAmount
        .times(r.amount)
        .dividedBy(r.payment.amount)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      return acc.plus(r.amount.minus(commissionShare));
    }, new Decimal(0));
    expect(owed.toString()).toBe(grossNet.minus(refundedNet).toString());

    // ── 5. A payout of everything owed ───────────────────────────────────
    const requester = await superAdmin('+37477830002');
    const confirmer = await superAdmin('+37477830003');
    const requested = await payouts.requestPayout({
      partnerId: partner.id,
      amount: owed.toString(),
      actorId: requester.id,
      idempotencyKey: 'recon-payout-1',
    });
    await payouts.confirmPaid(requested.payoutId, 'BANKREF-1', confirmer.id);

    await assertEveryAccountReconstructs();
    await assertBooksBalance();

    // The debt is gone, and it is gone because postings say so.
    expect((await replay(payable.id)).toString()).toBe('0');
    const settled = await prisma.payout.findUniqueOrThrow({ where: { id: requested.payoutId } });
    expect(settled.status).toBe(PayoutStatus.PAID);
  });

  it('reconstructs after a refund that follows the payout', async () => {
    // The order that actually breaks naive bookkeeping: the partner has
    // already been paid, and then a customer is refunded. The payable goes
    // negative — the partner now owes the platform — and that has to be a
    // real, reconstructable number rather than a floor at zero.
    const customer = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    await prisma.partner.update({
      where: { id: partner.id },
      data: { paymentCommissionRateBps: 250 },
    });

    const captured = await payments.capture({
      userId: customer.user.id,
      partnerId: partner.id,
      amount: '10000',
      sourceToken: 'tok_ok',
      idempotencyKey: 'recon-after-payout',
    });

    const payable = await ledger.accountFor({
      type: LedgerAccountType.PARTNER_PAYABLE,
      partnerId: partner.id,
      currency: 'AMD',
    });
    const owed = (await replay(payable.id)).negated();

    const requester = await superAdmin('+37477840001');
    const confirmer = await superAdmin('+37477840002');
    const payout = await payouts.requestPayout({
      partnerId: partner.id,
      amount: owed.toString(),
      actorId: requester.id,
      idempotencyKey: 'recon-payout-2',
    });
    await payouts.confirmPaid(payout.payoutId, 'BANKREF-2', confirmer.id);
    expect((await replay(payable.id)).toString()).toBe('0');

    const admin = await superAdmin('+37477840003');
    await refunds.refund({
      paymentId: captured.paymentId,
      amount: '10000',
      reason: 'full return after payout',
      actorId: admin.id,
      idempotencyKey: 'recon-refund-2',
    });

    // Debit-positive on a credit-normal account: the partner owes the
    // platform back the net they were paid on a sale that was undone.
    const after = await replay(payable.id);
    expect(after.greaterThan(0)).toBe(true);
    await assertEveryAccountReconstructs();
    await assertBooksBalance();
  });

  it('leaves no posting without a counterpart', async () => {
    // The property that makes any of the above meaningful. A single-sided
    // posting balances the books by accident today and by nothing tomorrow.
    const customer = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    await payments.capture({
      userId: customer.user.id,
      partnerId: partner.id,
      amount: '4321',
      sourceToken: 'tok_ok',
      idempotencyKey: 'recon-pairs',
    });
    await outbox.drain();

    const transactions = await prisma.ledgerTransaction.findMany({
      include: { postings: true },
    });
    expect(transactions.length).toBeGreaterThan(0);
    for (const transaction of transactions) {
      const net = transaction.postings.reduce(
        (acc, p) =>
          p.direction === PostingDirection.DEBIT ? acc.plus(p.amount) : acc.minus(p.amount),
        new Decimal(0),
      );
      expect({ id: transaction.id, net: net.toString() }).toEqual({
        id: transaction.id,
        net: '0',
      });
      expect(transaction.postings.length).toBeGreaterThanOrEqual(2);
    }
  });
});
