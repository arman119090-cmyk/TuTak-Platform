import { LedgerAccountType as A, PrismaClient } from '@prisma/client';
import { PartnerOrdersService } from '../src/modules/partner-orders/partner-orders.service';
import { PartnerOrderReturnsService } from '../src/modules/partner-orders/partner-order-returns.service';
import { OrderDisputesService } from '../src/modules/partner-orders/order-disputes.service';
import { PartnerSettlementStatementService } from '../src/modules/payouts/partner-settlement-statement.service';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { PayoutHistoryService } from '../src/modules/payouts/payout-history.service';
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
  let payouts: PayoutHistoryService;
  let engine: PartnerSettlementService;
  let s: ReturnType<typeof commerceSupport>;

  const savedTopUpFlag = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;

  beforeAll(async () => {
    // Real TuTak money reaches these customers through the real top-up flow,
    // which is off by default since 15.09.2026 (deposit-taking is an open
    // legal question). Set before the harness boots — config reads the env
    // at boot — and restored in afterAll, exactly as customer-balance does.
    process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = 'true';
    harness = await createTestHarness();
    prisma = harness.prisma;
    orders = harness.app.get(PartnerOrdersService);
    returns = harness.app.get(PartnerOrderReturnsService);
    disputes = harness.app.get(OrderDisputesService);
    statements = harness.app.get(PartnerSettlementStatementService);
    payouts = harness.app.get(PayoutHistoryService);
    engine = harness.app.get(PartnerSettlementService);
    s = commerceSupport(harness.app, prisma);
  });

  afterAll(async () => {
    if (savedTopUpFlag === undefined) delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    else process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = savedTopUpFlag;
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
    await orders.markDelivered(created.id, staff.id);
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

    it('Q9: already-spent green balance is netted from the money refund — nothing absorbed, no manual review', async () => {
      const { partner, staff, customer, order } = await completedOrder();
      // The customer spends the green 300 elsewhere before returning.
      const other = await createPartner(prisma);
      const otherStaff = await s.staff(other.id);
      const { PurchaseIntentsService } = await import('../src/modules/purchase-intents/purchase-intents.service');
      const intents = harness.app.get(PurchaseIntentsService);
      const spend = await intents.create({ partnerId: other.id, grossAmount: '1000', bonusAmountRequested: '300' }, customer.user.id);
      await intents.confirm(spend.id, otherStaff.id);

      const ret = await returns.createReturn({ orderId: order.id, reason: 'late', actorId: staff.id, actorType: 'PARTNER', idempotencyKey: 'sf-1' });
      expect(ret.status).toBe('COMPLETED');
      expect(ret.shortfallAmount.toFixed(4)).toBe('300.0000');
      expect(ret.grossRefund.toFixed(4)).toBe('30000.0000');
      expect(ret.recoveredShortfall.toFixed(4)).toBe('300.0000');
      expect(ret.netRefund.toFixed(4)).toBe('29700.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');
      expect(await s.balance(A.CUSTOMER_SHORTFALL_CLEARING, { userId: customer.user.id })).toBe('0.0000');
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(final.refundedAmount.toFixed(4)).toBe('30000.0000');
      expect(final.manualReviewReason).toBeNull();
      await s.assertAllAccountsReplay();
      await s.assertEscrowProvenance();
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
      // The frozen share is out of the payable, so a settlement finds nothing to claim.
      await expect(
        engine.createDraft({ partnerId: partner.id, actorId: admin.id, periodStart: new Date('2020-01-01T00:00:00.000Z'), periodEnd: new Date(Date.now() + 1000) }),
      ).rejects.toThrow(/Nothing to pay/);
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
    it('creates partner debt that the settlement engine carries into the next period', async () => {
      const { partner, admin, customer, order } = await completedOrder();
      const checker = await createStaffUser(prisma);
      await prisma.partnerBankAccount.create({
        data: { partnerId: partner.id, beneficiaryName: 'ООО Партнёр', accountNumber: 'AM00 2222', bankName: 'Тестбанк', createdByUserId: admin.id },
      });
      // Settle and pay through the one engine (docs/PARTNER_COMMERCE.md §14).
      const draft = await engine.createDraft({ partnerId: partner.id, actorId: admin.id, periodStart: new Date(Date.now() - 86_400_000), periodEnd: new Date(Date.now() + 1000) });
      expect(draft.netPayableAmount.toFixed(4)).toBe('28500.0000');
      await engine.markReady(draft.id, { actorId: admin.id });
      await engine.approve(draft.id, checker.id);
      await engine.markPaid(draft.id, { actorId: checker.id, bankTransferReference: 'BANK-M' });
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('0.0000');

      const dispute = await disputes.open({ orderId: order.id, type: 'ORDER', reason: 'broken', actorId: customer.user.id, actorType: 'CUSTOMER' });
      expect(dispute.openedAfterSettlement).toBe(true);
      expect(dispute.frozenAmount.toFixed(4)).toBe('0.0000');
      await disputes.resolve(dispute.id, admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '30000', note: 'broken' });
      // The customer got their money back; the partner now owes TuTak 28500 (positive = partner owes).
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: partner.id })).toBe('28500.0000');
      // The debt stays unclaimed and is netted against future earnings — the PAID settlement is untouched.
      const unsettled = await engine.unsettled(partner.id);
      expect(unsettled.net.toFixed(4)).toBe('-28500.0000');
      expect(unsettled.unrecognised).toEqual([]);
      await expect(
        engine.createDraft({ partnerId: partner.id, actorId: admin.id, periodStart: new Date(Date.now() - 86_400_000), periodEnd: new Date(Date.now() + 1000) }),
      ).rejects.toThrow(/Nothing to pay/);
      expect((await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('PAID');
      const summary = await statements.balanceSummary(partner.id);
      expect(summary.dueToTutak).toBe('28500.0000');
      expect(summary.unsettledNet).toBe('-28500.0000');
      await s.assertAllAccountsReplay();
    });
  });

  describe('remaining races and idempotency (spec §60-61)', () => {
    it('customer received × refund: a return never runs before completion, and runs once after', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const admin = await createStaffUser(prisma);
      const integrationId = await s.websiteIntegration(partner.id, admin.id);
      const staff = await s.staff(partner.id);
      const customer = await s.customer('50000');
      const created = await orders.create(partner.id, integrationId, orderDto('RR-1'));
      await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'rr-1' });
      await orders.confirmStock(created.id, staff.id);
      const [received, ret] = await Promise.allSettled([
        orders.confirmReceived(created.id, customer.user.id),
        returns.createReturn({ orderId: created.id, reason: 'race', actorId: staff.id, actorType: 'PARTNER', idempotencyKey: 'rr-ret' }),
      ]);
      expect(received.status).toBe('fulfilled');
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } });
      expect(final.operationalStatus).toBe('COMPLETED');
      const returnsCount = await prisma.partnerOrderReturn.count({ where: { orderId: created.id } });
      expect(returnsCount).toBe(ret.status === 'fulfilled' ? 1 : 0);
      await s.assertAllAccountsReplay();
    });

    it('a duplicated top-up callback (IDRAM, when connected) credits the balance once', async () => {
      const { customer } = await referredCustomer('50000');
      const { randomUUID } = await import('node:crypto');
      const { CustomerBalanceService } = await import('../src/modules/customer-balance/customer-balance.service');
      const { BANK_TOPUP_ADAPTER } = await import('../src/modules/customer-balance/bank-topup-adapter.interface');
      const balance = harness.app.get(CustomerBalanceService);
      const bank = harness.app.get<{ initiateTopUp: () => Promise<unknown>; verifyTopUpWebhook: () => Promise<unknown> }>(BANK_TOPUP_ADAPTER);
      const providerReference = `P-${randomUUID()}`;
      jest.spyOn(bank, 'initiateTopUp').mockResolvedValueOnce({ outcome: 'INITIATED', providerReference });
      await balance.initiateTopUp(customer.user.id, '7000');
      jest.spyOn(bank, 'verifyTopUpWebhook').mockResolvedValue({ providerReference, outcome: 'COMPLETED' });
      await Promise.allSettled([
        balance.confirmTopUpWebhook({ reference: providerReference }, {}),
        balance.confirmTopUpWebhook({ reference: providerReference }, {}),
        balance.confirmTopUpWebhook({ reference: providerReference }, {}),
      ]);
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-57000.0000');
      await s.assertAllAccountsReplay();
    });
  });
});
