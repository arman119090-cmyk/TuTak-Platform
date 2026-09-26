import { LedgerAccountType as A, PrismaClient } from '@prisma/client';
import { PartnerOrdersService } from '../src/modules/partner-orders/partner-orders.service';
import { PartnerOrderReturnsService } from '../src/modules/partner-orders/partner-order-returns.service';
import { OrderDisputesService } from '../src/modules/partner-orders/order-disputes.service';
import { PartnerSettlementStatementService, periodStartFor } from '../src/modules/payouts/partner-settlement-statement.service';
import { PayoutEngineService } from '../src/modules/payouts/payout-engine.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { commerceSupport, orderDto } from './support/commerce';

/**
 * Partner Commerce v2 — returns, disputes and settlement statements
 * (spec §44-52, §72 J-M, §61 races). Real Postgres; every scenario replays
 * the whole ledger at the end.
 */
describe('Partner Commerce — returns, disputes, settlement (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let orders: PartnerOrdersService;
  let returns: PartnerOrderReturnsService;
  let disputes: OrderDisputesService;
  let statements: PartnerSettlementStatementService;
  let payouts: PayoutEngineService;
  let s: ReturnType<typeof commerceSupport>;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    orders = harness.app.get(PartnerOrdersService);
    returns = harness.app.get(PartnerOrderReturnsService);
    disputes = harness.app.get(OrderDisputesService);
    statements = harness.app.get(PartnerSettlementStatementService);
    payouts = harness.app.get(PayoutEngineService);
    s = commerceSupport(harness.app, prisma);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  /** A customer with an L1 user referrer, so the referral leg is exercised too. */
  async function referredCustomer(money: string, discount?: string) {
    const customer = await s.customer(money, discount);
    const { user: referrer } = await createCustomer(prisma);
    await prisma.referralCode.create({ data: { userId: referrer.id, code: `TT-REF-${referrer.id.slice(0, 8)}` } });
    await prisma.referralInvite.create({ data: { referrerType: 'USER', referrerUserId: referrer.id, refereeUserId: customer.user.id } });
    return { customer, referrer };
  }

  async function completedOrder(opts: { money?: string; discount?: string; external?: boolean } = {}) {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const admin = await createStaffUser(prisma);
    const integrationId = await s.websiteIntegration(partner.id, admin.id);
    const staff = await s.staff(partner.id);
    const { customer, referrer } = await referredCustomer('50000', opts.discount);
    const created = await orders.create(partner.id, integrationId, orderDto(`O-${Math.random()}`));
    const submitted = await orders.submit(created.id, customer.user.id, {
      tutakMoneyAmount: opts.money ?? '30000',
      discountAmount: opts.discount,
      idempotencyKey: `k-${created.id}`,
    });
    const external = submitted.paymentLegs.find((l) => l.type === 'EXTERNAL');
    if (external) await orders.confirmExternalPayment(external.id, staff.id);
    await orders.confirmStock(created.id, staff.id);
    await orders.markHandedOver(created.id, staff.id);
    const done = await orders.confirmReceived(created.id, customer.user.id);
    expect(done.operationalStatus).toBe('COMPLETED');
    return { partner, admin, staff, customer, referrer, order: done };
  }

  describe('scenario J — full return', () => {
    it('reverses every allocation leg with linked entries and returns the money', async () => {
      const { partner, staff, customer, referrer, order } = await completedOrder();
      expect(order.referrer1Amount?.toFixed(4)).toBe('150.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('-28500.0000');

      const ret = await returns.createReturn({
        orderId: order.id,
        reason: 'defective',
        actorId: staff.id,
        actorType: 'PARTNER',
        idempotencyKey: 'return-j-1',
      });
      expect(ret.status).toBe('COMPLETED');
      expect(ret.poolReversed.toFixed(4)).toBe('1500.0000');
      expect(ret.tutakMoneyRefunded.toFixed(4)).toBe('30000.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      expect(await s.balance(A.BONUS_LIABILITY)).toBe('0.0000');
      expect(await s.balance(A.PLATFORM_REVENUE)).toBe('0.0000');
      const customerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(customerWallet.availableBonus.toFixed(4)).toBe('0.0000');
      const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
      expect(referrerWallet.availableBonus.toFixed(4)).toBe('0.0000');
      // The original postings are untouched; the reversal is a new, linked transaction.
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution', sourceId: order.id } })).toBe(1);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution_refund', sourceId: ret.id } })).toBe(1);
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(final.paymentStatus).toBe('REFUNDED');
      expect(final.operationalStatus).toBe('COMPLETED');
      await s.assertAllAccountsReplay();
    });
  });

  describe('scenario K — partial return', () => {
    it('reverses only the proportional share; the same request twice is one return; never over-returns', async () => {
      const { partner, staff, order } = await completedOrder();
      const params = { orderId: order.id, amount: '12000', reason: '40% back', actorId: staff.id, actorType: 'PARTNER' as const, idempotencyKey: 'k-40' };
      const [a, b] = await Promise.all([returns.createReturn(params), returns.createReturn(params)]);
      expect(a.id).toBe(b.id);
      expect(a.poolReversed.toFixed(4)).toBe('600.0000');
      // 18000 still sold at 5% → partner is owed 18000 − 900.
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('-17100.0000');

      // Two different partial returns at once serialise; together they cannot exceed the total.
      const results = await Promise.allSettled([
        returns.createReturn({ ...params, amount: '12000', idempotencyKey: 'k-40-b' }),
        returns.createReturn({ ...params, amount: '12000', idempotencyKey: 'k-40-c' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(final.refundedAmount.toFixed(4)).toBe('24000.0000');
      expect(final.paymentStatus).toBe('PARTIALLY_REFUNDED');
      await s.assertAllAccountsReplay();
    });

    it('a mixed order returns the external share through the partner, confirmed on shift', async () => {
      const { partner, staff, customer, order } = await completedOrder({ money: '10000', discount: '5000' });
      const ret = await returns.createReturn({
        orderId: order.id,
        reason: 'returned',
        actorId: staff.id,
        actorType: 'PARTNER',
        idempotencyKey: 'mixed-1',
      });
      expect(ret.status).toBe('PENDING_EXTERNAL_REFUND');
      expect(ret.discountRestored.toFixed(4)).toBe('5000.0000');
      expect(ret.tutakMoneyRefunded.toFixed(4)).toBe('10000.0000');
      expect(ret.externalRefundDue.toFixed(4)).toBe('15000.0000');
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('5000.0000');
      const confirmed = await returns.confirmExternalRefund(ret.id, staff.id);
      expect(confirmed.status).toBe('COMPLETED');
      expect((await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe('REFUNDED');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');
      await s.assertAllAccountsReplay();
    });

    it('already-spent green balance → MANUAL_REVIEW, nothing moved, TuTak absorbs nothing (Q7a)', async () => {
      const { partner, staff, customer, order } = await completedOrder();
      // The customer spends the green 300 elsewhere before returning.
      const other = await createPartner(prisma);
      const otherStaff = await s.staff(other.id);
      const { PurchaseIntentsService } = await import('../src/modules/purchase-intents/purchase-intents.service');
      const intents = harness.app.get(PurchaseIntentsService);
      const spend = await intents.create({ partnerId: other.id, grossAmount: '1000', bonusAmountRequested: '300' }, customer.user.id);
      await intents.confirm(spend.id, otherStaff.id);

      const before = await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id });
      const ret = await returns.createReturn({ orderId: order.id, reason: 'late', actorId: staff.id, actorType: 'PARTNER', idempotencyKey: 'sf-1' });
      expect(ret.status).toBe('MANUAL_REVIEW');
      expect(ret.shortfallAmount.toFixed(4)).toBe('300.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe(before);
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(final.refundedAmount.toFixed(4)).toBe('0.0000');
      expect(final.manualReviewReason).toBe('return_shortfall');
      await expect(
        returns.createReturn({ orderId: order.id, reason: 'again', actorId: staff.id, actorType: 'PARTNER', idempotencyKey: 'sf-2' }),
      ).rejects.toThrow(/manual review/);
      await s.assertAllAccountsReplay();
    });
  });

  describe('scenario L — dispute before settlement', () => {
    it('freezes the partner credit out of any payout until an admin decides', async () => {
      const { partner, admin, customer, order } = await completedOrder();
      const dispute = await disputes.open({ orderId: order.id, type: 'ORDER', reason: 'damaged', actorId: customer.user.id, actorType: 'CUSTOMER' });
      expect(dispute.openedAfterSettlement).toBe(false);
      expect(dispute.frozenAmount.toFixed(4)).toBe('28500.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');
      expect(await s.balance(A.PARTNER_DISPUTE_HOLD, { partnerId: partner.id })).toBe('-28500.0000');
      expect((await payouts.availableBalance(partner.id)).toFixed(4)).toBe('0.0000');
      await expect(
        payouts.requestPayout({ partnerId: partner.id, amount: '100', actorId: admin.id, idempotencyKey: 'po-1' }),
      ).rejects.toThrow();
      const summary = await statements.balanceSummary(partner.id);
      expect(summary.frozenForDisputes).toBe('28500.0000');

      await expect(
        disputes.open({ orderId: order.id, type: 'ORDER', reason: 'again', actorId: customer.user.id, actorType: 'CUSTOMER' }),
      ).rejects.toThrow(/already open/);

      // Two admins deciding at once: one decision.
      const results = await Promise.allSettled([
        disputes.resolve(dispute.id, admin.id, { outcome: 'RESOLVED_PARTNER', note: 'photos show no damage' }),
        disputes.resolve(dispute.id, admin.id, { outcome: 'RESOLVED_PARTNER', note: 'duplicate click' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('-28500.0000');
      expect(await s.balance(A.PARTNER_DISPUTE_HOLD, { partnerId: partner.id })).toBe('0.0000');
      expect(await prisma.auditLog.count({ where: { action: 'ORDER_DISPUTE_RESOLVED' } })).toBe(1);
      await s.assertAllAccountsReplay();
    });

    it('a customer-favourable decision releases the hold and runs the return', async () => {
      const { partner, admin, customer, order } = await completedOrder();
      const dispute = await disputes.open({ orderId: order.id, type: 'ORDER', reason: 'wrong item', actorId: customer.user.id, actorType: 'CUSTOMER' });
      await disputes.resolve(dispute.id, admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '30000', note: 'wrong item confirmed' });
      expect(await s.balance(A.PARTNER_DISPUTE_HOLD, { partnerId: partner.id })).toBe('0.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      const ret = await prisma.partnerOrderReturn.findFirstOrThrow({ where: { disputeId: dispute.id } });
      expect(ret.origin).toBe('ADMIN');
      await s.assertAllAccountsReplay();
    });
  });

  describe('scenario M — dispute after settlement', () => {
    it('creates partner debt that the next statement carries', async () => {
      const { partner, admin, customer, order } = await completedOrder();
      // Settle: the period containing the completion ends; the statement is generated; TuTak pays out.
      const periodStart = periodStartFor(new Date(Date.now() - 3 * 86_400_000), 'DAILY');
      const first = await statements.generate(partner.id, 'DAILY', periodStart, new Date(Date.now() + 1000));
      expect(first!.closingBalance.toFixed(4)).toBe('-28500.0000');
      const payout = await payouts.requestPayout({ partnerId: partner.id, amount: '28500', actorId: admin.id, idempotencyKey: 'po-m' });
      expect(payout.payoutId).toBeDefined();
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');

      const dispute = await disputes.open({ orderId: order.id, type: 'ORDER', reason: 'broken', actorId: customer.user.id, actorType: 'CUSTOMER' });
      expect(dispute.openedAfterSettlement).toBe(true);
      expect(dispute.frozenAmount.toFixed(4)).toBe('0.0000');
      await disputes.resolve(dispute.id, admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '30000', note: 'broken' });
      // The customer got their money back; the partner now owes TuTak 28500 (positive = partner owes).
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('28500.0000');
      const next = await statements.generate(partner.id, 'DAILY', first!.periodEnd, new Date(Date.now() + 2000));
      expect(next!.openingBalance.toFixed(4)).toBe('-28500.0000');
      expect(next!.closingBalance.toFixed(4)).toBe('28500.0000');
      const summary = await statements.balanceSummary(partner.id);
      expect(summary.dueToTutak).toBe('28500.0000');
      await s.assertAllAccountsReplay();
    });
  });

  describe('settlement statements', () => {
    it('two workers generate one statement; every line traces to a posting; closing = opening + lines', async () => {
      const { partner } = await completedOrder();
      const start = periodStartFor(new Date(Date.now() - 86_400_000), 'DAILY');
      const end = new Date(Date.now() + 1000);
      const [a, b] = await Promise.all([
        statements.generate(partner.id, 'DAILY', start, end),
        statements.generate(partner.id, 'DAILY', start, end),
      ]);
      expect(a!.id).toBe(b!.id);
      expect(await prisma.partnerSettlementStatement.count()).toBe(1);
      const full = await statements.get(a!.id);
      const sum = full.lines.filter((l) => l.accountType === 'PARTNER_PAYABLE').reduce((acc, l) => acc + Number(l.signedAmount), 0);
      expect((Number(full.openingBalance) + sum).toFixed(4)).toBe(Number(full.closingBalance).toFixed(4));
      expect(full.closingBalance.toFixed(4)).toBe(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id }));
      const kinds = new Set(full.lines.map((l) => l.kind));
      expect(kinds).toEqual(new Set(['partner_order.completion', 'partner.contribution']));
    });

    it('refund × settlement: a return racing the statement is on exactly one statement', async () => {
      const { partner, staff, order } = await completedOrder();
      const start = periodStartFor(new Date(Date.now() - 86_400_000), 'DAILY');
      const [, statement] = await Promise.all([
        returns.createReturn({ orderId: order.id, amount: '3000', reason: 'r', actorId: staff.id, actorType: 'PARTNER', idempotencyKey: 'rs-1' }),
        statements.generate(partner.id, 'DAILY', start, new Date(Date.now() + 5000)),
      ]);
      const next = await statements.generate(partner.id, 'DAILY', statement!.periodEnd, new Date(Date.now() + 10_000));
      const lines = await prisma.partnerSettlementStatementLine.findMany();
      expect(new Set(lines.map((l) => l.postingId)).size).toBe(lines.length);
      expect((next ?? statement)!.closingBalance.toFixed(4)).toBe(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id }));
    });

    it('dispute open × settlement: the frozen amount is never payable', async () => {
      const { partner, admin, customer, order } = await completedOrder();
      const start = periodStartFor(new Date(Date.now() - 86_400_000), 'DAILY');
      await Promise.allSettled([
        disputes.open({ orderId: order.id, type: 'ORDER', reason: 'x', actorId: customer.user.id, actorType: 'CUSTOMER' }),
        statements.generate(partner.id, 'DAILY', start, new Date(Date.now() + 5000)),
      ]);
      const available = await payouts.availableBalance(partner.id);
      const hold = await s.balance(A.PARTNER_DISPUTE_HOLD, { partnerId: partner.id });
      // Whatever the interleaving: payable + frozen = the order's net credit, and payouts only see payable.
      expect(available.plus(Number(hold) * -1).toFixed(4)).toBe('28500.0000');
      if (hold !== '0.0000') {
        await expect(payouts.requestPayout({ partnerId: partner.id, amount: '28500', actorId: admin.id, idempotencyKey: 'po-x' })).rejects.toThrow();
      }
      await s.assertAllAccountsReplay();
    });

    it('computes period boundaries on the Yerevan wall clock', () => {
      // 2026-09-26 is a Saturday.
      const at = new Date('2026-09-26T10:00:00Z');
      expect(periodStartFor(at, 'DAILY').toISOString()).toBe('2026-09-25T20:00:00.000Z');
      expect(periodStartFor(at, 'WEEKLY').toISOString()).toBe('2026-09-20T20:00:00.000Z');
      expect(periodStartFor(at, 'MONTHLY').toISOString()).toBe('2026-08-31T20:00:00.000Z');
      const biweekly = periodStartFor(at, 'BIWEEKLY');
      expect([new Date('2026-09-20T20:00:00Z').getTime(), new Date('2026-09-13T20:00:00Z').getTime()]).toContain(biweekly.getTime());
    });
  });
});
