import { LedgerAccountType as A, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerOrdersService } from '../src/modules/partner-orders/partner-orders.service';
import { PartnerOrderReturnsService } from '../src/modules/partner-orders/partner-order-returns.service';
import { PartnerOrderCancellationService } from '../src/modules/partner-orders/partner-order-cancellation.service';
import { PartnerOrderSlaSweepService } from '../src/modules/partner-orders/partner-order-sla-sweep.service';
import { CommerceRulesService } from '../src/modules/partner-orders/commerce-rules.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { commerceSupport, orderDto } from './support/commerce';

const HOUR = 3_600_000;

/**
 * Partner Commerce — the final fixes after 7e44ad8 (docs/PARTNER_COMMERCE.md
 * §10): Q8 referral withholding, Q9 customer-shortfall netting and desk
 * settlement (online and QR, policy-versioned), Q10 immediate payment
 * issue, Q13 real-money prepayment, the delivery split and its timers, the
 * cancellation actual-cost review, and escrow provenance. Real Postgres;
 * every scenario replays the whole ledger and proves the escrow provenance.
 */
describe('Partner Commerce — final fixes (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let orders: PartnerOrdersService;
  let returns: PartnerOrderReturnsService;
  let cancellations: PartnerOrderCancellationService;
  let sla: PartnerOrderSlaSweepService;
  let rules: CommerceRulesService;
  let intents: PurchaseIntentsService;
  let qrRefunds: PurchaseIntentRefundService;
  let bonusEngine: BonusEngineService;
  let s: ReturnType<typeof commerceSupport>;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    orders = harness.app.get(PartnerOrdersService);
    returns = harness.app.get(PartnerOrderReturnsService);
    cancellations = harness.app.get(PartnerOrderCancellationService);
    sla = harness.app.get(PartnerOrderSlaSweepService);
    rules = harness.app.get(CommerceRulesService);
    intents = harness.app.get(PurchaseIntentsService);
    qrRefunds = harness.app.get(PurchaseIntentRefundService);
    bonusEngine = harness.app.get(BonusEngineService);
    s = commerceSupport(harness.app, prisma);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    await s.assertAllAccountsReplay();
    await s.assertEscrowProvenance();
  });

  async function partnerSetup(opts: { rateBps?: number; maxBonusPaymentPercent?: number } = {}) {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: opts.rateBps ?? 500, maxBonusPaymentPercent: opts.maxBonusPaymentPercent });
    const admin = await createStaffUser(prisma);
    const integrationId = await s.websiteIntegration(partner.id, admin.id);
    const staff = await s.staff(partner.id);
    return { partner, admin, integrationId, staff };
  }

  async function invite(refereeUserId: string, referrer: { type: 'USER'; userId: string } | { type: 'PARTNER'; partnerId: string }) {
    if (referrer.type === 'USER') {
      await prisma.referralCode.create({ data: { userId: referrer.userId, code: `TT-${referrer.userId.slice(0, 8)}` } });
      await prisma.referralInvite.create({ data: { referrerType: 'USER', referrerUserId: referrer.userId, refereeUserId } });
    } else {
      await prisma.referralInvite.create({ data: { referrerType: 'PARTNER', referrerPartnerId: referrer.partnerId, refereeUserId } });
    }
  }

  /** Spend `bonus` of a user's green balance at another partner (a real QR purchase). */
  async function spendGreen(userId: string, bonus: string, gross = '10000') {
    const other = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const otherStaff = await s.staff(other.id);
    const spend = await intents.create({ partnerId: other.id, grossAmount: gross, bonusAmountRequested: bonus }, userId);
    await intents.confirm(spend.id, otherStaff.id);
    return { other, otherStaff };
  }

  async function complete(
    setup: Awaited<ReturnType<typeof partnerSetup>>,
    customerId: string,
    split: { money?: string; discount?: string; confirmExternal?: boolean },
    unitPrice: string,
    extra: Record<string, unknown> = {},
  ) {
    const created = await orders.create(setup.partner.id, setup.integrationId, orderDto(`F-${Math.random()}`, unitPrice, extra));
    const submitted = await orders.submit(created.id, customerId, {
      tutakMoneyAmount: split.money,
      discountAmount: split.discount,
      idempotencyKey: `k-${created.id}`,
    });
    const external = submitted.paymentLegs.find((l) => l.type === 'EXTERNAL');
    if (external && split.confirmExternal !== false) await orders.confirmExternalPayment(external.id, setup.staff.id);
    await orders.confirmStock(created.id, setup.staff.id);
    await orders.markDelivered(created.id, setup.staff.id);
    return orders.confirmReceived(created.id, customerId);
  }

  // ── Q8 ────────────────────────────────────────────────────────────────────

  describe('Q8 — a spent referral share becomes a withholding repaid by future accruals', () => {
    it('allocation 200, available 50, spent 150 → 50 reversed now, 150 withheld; the partner is credited as it is repaid', async () => {
      const setup = await partnerSetup({ rateBps: 500 });
      const customer = await s.customer('50000');
      const { user: referrer } = await createCustomer(prisma);
      await invite(customer.user.id, { type: 'USER', userId: referrer.id });

      // 40000 at 5% → pool 2000 → L1 (10%) = 200.
      const order = await complete(setup, customer.user.id, { money: '40000' }, '40000');
      expect(order.operationalStatus).toBe('COMPLETED');
      expect(order.referrer1Amount?.toFixed(4)).toBe('200.0000');
      await spendGreen(referrer.id, '150');
      const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
      // 200 referral + 0 own green from the spend (bonus-paid part earns nothing extra here) − 150 spent.
      const availableBeforeReturn = referrerWallet.availableBonus;

      const ret = await returns.createReturn({ orderId: order.id, reason: 'defective', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q8-1' });
      expect(ret.status).toBe('COMPLETED');
      expect(ret.referralWithheld.toFixed(4)).toBe('150.0000');
      const withholding = await prisma.referralWithholding.findFirstOrThrow({ where: { userId: referrer.id } });
      expect(withholding.amount.toFixed(4)).toBe('150.0000');
      expect(withholding.remainingAmount.toFixed(4)).toBe('150.0000');
      expect(withholding.status).toBe('OPEN');
      expect(withholding.beneficiaryPartnerId).toBe(setup.partner.id);
      // Never a negative balance, never the referrer's real money.
      const afterReturn = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
      expect(afterReturn.availableBonus.toFixed(4)).toBe(availableBeforeReturn.minus(50).toFixed(4));
      expect(afterReturn.availableBonus.isNegative()).toBe(false);
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: referrer.id })).toBe('0.0000');
      // The partner waits for the 150: its commission refund is 2000 − 150 for now.
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe('150.0000');
      // No MANUAL_REVIEW for a referral shortfall any more.
      expect(await prisma.partnerOrderReturn.count({ where: { status: 'MANUAL_REVIEW' } })).toBe(0);

      // The referrer's next positive accruals repay it first: their own green
      // from two QR purchases (10000 and 5000 at 5% → pool 500/250 → green 100/50).
      const shop = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const shopStaff = await s.staff(shop.id);
      await s.fundMoney(referrer.id, '20000');
      const p1 = await intents.create({ partnerId: shop.id, grossAmount: '10000', tutakMoneyAmount: '10000' }, referrer.id);
      await intents.confirm(p1.id, shopStaff.id);
      const partial = await prisma.referralWithholding.findUniqueOrThrow({ where: { id: withholding.id } });
      expect(partial.remainingAmount.toFixed(4)).toBe('50.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe('50.0000');
      const walletAfterP1 = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
      expect(walletAfterP1.availableBonus.toFixed(4)).toBe(afterReturn.availableBonus.toFixed(4));

      const p2 = await intents.create({ partnerId: shop.id, grossAmount: '10000', tutakMoneyAmount: '10000' }, referrer.id);
      await intents.confirm(p2.id, shopStaff.id);
      const settled = await prisma.referralWithholding.findUniqueOrThrow({ where: { id: withholding.id }, include: { recoveries: true } });
      expect(settled.status).toBe('SETTLED');
      expect(settled.remainingAmount.toFixed(4)).toBe('0.0000');
      expect(settled.recoveries.map((r) => r.amount.toFixed(0)).sort()).toEqual(['100', '50']);
      // Only the remainder became available: 100 green − 50 withheld.
      const walletAfterP2 = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
      expect(walletAfterP2.availableBonus.toFixed(4)).toBe(afterReturn.availableBonus.plus(50).toFixed(4));
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe('0.0000');
      const history = await prisma.bonusLedgerEntry.findMany({ where: { walletId: walletAfterP2.id, type: 'WITHHOLDING' } });
      expect(history.map((h) => h.amount.toFixed(0)).sort()).toEqual(['100', '50']);
      expect(await prisma.auditLog.count({ where: { action: 'REFERRAL_WITHHOLDING_RECOVERED' } })).toBe(2);
    });

    it('a PARTNER referrer is reversed from its own payable — no withholding', async () => {
      const setup = await partnerSetup({ rateBps: 500 });
      const referringPartner = await createPartner(prisma);
      const customer = await s.customer('50000');
      await invite(customer.user.id, { type: 'PARTNER', partnerId: referringPartner.id });
      const order = await complete(setup, customer.user.id, { money: '40000' }, '40000');
      expect(order.referrer1Type).toBe('PARTNER');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: referringPartner.id })).toBe('-200.0000');
      await returns.createReturn({ orderId: order.id, reason: 'defective', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q8-p' });
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: referringPartner.id })).toBe('0.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe('0.0000');
      expect(await prisma.referralWithholding.count()).toBe(0);
    });

    it('two concurrent accruals repay one withholding exactly once', async () => {
      const setup = await partnerSetup({ rateBps: 500 });
      const customer = await s.customer('50000');
      const { user: referrer, wallet } = await createCustomer(prisma);
      await invite(customer.user.id, { type: 'USER', userId: referrer.id });
      const order = await complete(setup, customer.user.id, { money: '40000' }, '40000');
      await spendGreen(referrer.id, '150');
      await returns.createReturn({ orderId: order.id, reason: 'x', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q8-c' });
      await Promise.all([
        bonusEngine.accrue({ walletId: wallet.id, type: 'ACCRUAL_PROMOTION', amount: '100', pendingHours: 0 }),
        bonusEngine.accrue({ walletId: wallet.id, type: 'ACCRUAL_PROMOTION', amount: '100', pendingHours: 0 }),
      ]);
      const w = await prisma.referralWithholding.findFirstOrThrow({ where: { userId: referrer.id }, include: { recoveries: true } });
      expect(w.status).toBe('SETTLED');
      expect(w.recoveries.reduce((sum, r) => sum.plus(r.amount), new Decimal(0)).toFixed(4)).toBe('150.0000');
      // 100 (own green from the spend, left after the return) + 200 accrued − 150 repaid.
      const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
      expect(after.availableBonus.toFixed(4)).toBe('150.0000');
    });
  });

  // ── Q9 ────────────────────────────────────────────────────────────────────

  describe('Q9 — the customer shortfall is netted, never absorbed and never a hidden debt', () => {
    it('online, COMMERCE_V2: nets the spent green from the money refund — gross, recovered and net shown separately', async () => {
      const setup = await partnerSetup({ rateBps: 2000 });
      const customer = await s.customer('60000');
      // 50000 at 20% → pool 10000 → green 2000.
      const order = await complete(setup, customer.user.id, { money: '50000' }, '50000');
      expect(order.financialPolicyVersion).toBe('COMMERCE_V2');
      expect(order.greenAmount?.toFixed(4)).toBe('2000.0000');
      await spendGreen(customer.user.id, '1700');
      const moneyBefore = await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id });

      const ret = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-net' });
      expect(ret.status).toBe('COMPLETED');
      expect(ret.shortfallAmount.toFixed(4)).toBe('1700.0000');
      expect(ret.grossRefund.toFixed(4)).toBe('50000.0000');
      expect(ret.recoveredShortfall.toFixed(4)).toBe('1700.0000');
      expect(ret.netRefund.toFixed(4)).toBe('48300.0000');
      expect(ret.tutakMoneyGross.toFixed(4)).toBe('50000.0000');
      expect(ret.tutakMoneyRefunded.toFixed(4)).toBe('48300.0000');
      expect(ret.shortfallFromMoney.toFixed(4)).toBe('1700.0000');
      expect(new Decimal(moneyBefore).minus(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toFixed(4)).toBe('48300.0000');
      // The ledger shows gross / net / recovered on one posting.
      const posting = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'partner_order.return_money', sourceId: ret.id },
        include: { postings: { include: { account: true } } },
      });
      expect(posting.postings.map((p) => `${p.account.type}:${p.direction}:${p.amount.toFixed(0)}`).sort()).toEqual([
        'CUSTOMER_PREPAID_BALANCE:CREDIT:48300',
        'CUSTOMER_SHORTFALL_CLEARING:CREDIT:1700',
        'PARTNER_PAYABLE:DEBIT:50000',
      ]);
      expect(await s.balance(A.CUSTOMER_SHORTFALL_CLEARING, { userId: customer.user.id })).toBe('0.0000');
      // TuTak absorbed nothing: platform revenue is back where it was before the order.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.isNegative()).toBe(false);
    });

    it('online: the rest is settled at the desk — nothing moves until an employee on shift confirms', async () => {
      const setup = await partnerSetup({ rateBps: 2000 });
      const customer = await s.customer();
      // Paid in cash to the partner: 50000 external, confirmed.
      const order = await complete(setup, customer.user.id, {}, '50000');
      await spendGreen(customer.user.id, '1700');
      const payableBefore = await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id });
      const lotBefore = await prisma.bonusLot.findFirstOrThrow({ where: { sourceTransactionId: order.sourceTransactionId!, type: 'ACCRUAL_PURCHASE' } });

      const pending = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-desk' });
      expect(pending.status).toBe('AWAITING_SHORTFALL_SETTLEMENT');
      expect(pending.externalRefundGross.toFixed(4)).toBe('50000.0000');
      expect(pending.shortfallFromExternal.toFixed(4)).toBe('1700.0000');
      expect(pending.externalRefundDue.toFixed(4)).toBe('48300.0000');
      expect(pending.shortfallCollected.toFixed(4)).toBe('0.0000');
      // Nothing moved.
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe(payableBefore);
      expect((await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } })).refundedAmount.toFixed(4)).toBe('0.0000');
      expect((await prisma.bonusLot.findUniqueOrThrow({ where: { id: lotBefore.id } })).remainingAmount.toFixed(4)).toBe(lotBefore.remainingAmount.toFixed(4));
      await expect(
        returns.createReturn({ orderId: order.id, reason: 'another', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-desk-2' }),
      ).rejects.toThrow(/still being settled/);
      await expect(returns.confirmExternalRefund(pending.id, setup.staff.id)).rejects.toThrow(/Settle the shortfall/);

      await expect(returns.settleShortfall(pending.id, setup.staff.id, '100')).rejects.toThrow(/amount to collect is 0/);
      const settled = await returns.settleShortfall(pending.id, setup.staff.id, '0');
      expect(settled.status).toBe('COMPLETED');
      expect(settled.grossRefund.toFixed(4)).toBe('50000.0000');
      expect(settled.recoveredShortfall.toFixed(4)).toBe('1700.0000');
      expect(settled.netRefund.toFixed(4)).toBe('48300.0000');
      expect(settled.settledByUserId).toBe(setup.staff.id);
      // The partner kept 1700 of the customer's cash for TuTak: it now owes it in settlement.
      const recovery = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'partner_order.shortfall_settled_at_desk', sourceId: pending.id },
        include: { postings: { include: { account: true } } },
      });
      expect(recovery.postings.map((p) => `${p.account.type}:${p.direction}:${p.amount.toFixed(0)}`).sort()).toEqual([
        'CUSTOMER_SHORTFALL_CLEARING:CREDIT:1700',
        'PARTNER_PAYABLE:DEBIT:1700',
      ]);
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe('1700.0000');
      // Settling twice is a no-op.
      expect((await returns.settleShortfall(pending.id, setup.staff.id, '0')).id).toBe(pending.id);
    });

    it('online: a shortfall larger than every refund is collected at the desk', async () => {
      const setup = await partnerSetup({ rateBps: 2000, maxBonusPaymentPercent: 100 });
      const customer = await s.customer(undefined, '5000');
      // Fully paid with the discount: no money comes back at all.
      const order = await complete(setup, customer.user.id, { discount: '5000' }, '5000');
      expect(order.greenAmount?.toFixed(4)).toBe('200.0000');
      await spendGreen(customer.user.id, '200', '1000');
      const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });

      const pending = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-collect' });
      expect(pending.status).toBe('AWAITING_SHORTFALL_SETTLEMENT');
      expect(pending.shortfallCollected.toFixed(4)).toBe('200.0000');
      expect(pending.grossRefund.toFixed(4)).toBe('0.0000');
      const done = await returns.settleShortfall(pending.id, setup.staff.id, '200');
      expect(done.status).toBe('COMPLETED');
      expect(done.discountRestored.toFixed(4)).toBe('5000.0000');
      expect(done.recoveredShortfall.toFixed(4)).toBe('200.0000');
      // The discount went back only to the discount balance; no money moved to it.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.minus(walletBefore.availableBonus).toFixed(4)).toBe('5000.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('0.0000');
    });

    it('online: the customer refuses → MANUAL_REVIEW, nothing moves; the operator may withdraw or reopen', async () => {
      const setup = await partnerSetup({ rateBps: 2000 });
      const customer = await s.customer();
      const order = await complete(setup, customer.user.id, {}, '50000');
      await spendGreen(customer.user.id, '1700');
      const payableBefore = await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id });

      const pending = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-refuse' });
      const refused = await returns.refuseShortfall(pending.id, { userId: customer.user.id, type: 'CUSTOMER' }, 'I do not agree with 1700');
      expect(refused.status).toBe('MANUAL_REVIEW');
      expect((await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } })).manualReviewReason).toBe('return_shortfall_disputed');
      expect(await prisma.orderEscalation.count({ where: { orderId: order.id, type: 'RETURN_SHORTFALL_REVIEW', resolvedAt: null } })).toBe(1);
      await expect(returns.settleShortfall(pending.id, setup.staff.id, '0')).rejects.toThrow(/not awaiting/);
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe(payableBefore);

      const reopened = await returns.reviewShortfall(pending.id, setup.admin.id, 'REOPEN', 'Customer agreed by phone');
      expect(reopened.status).toBe('AWAITING_SHORTFALL_SETTLEMENT');
      await returns.refuseShortfall(pending.id, { userId: setup.staff.id, type: 'PARTNER' }, 'refused again at the desk');
      const withdrawn = await returns.reviewShortfall(pending.id, setup.admin.id, 'WITHDRAW', 'Return not executed');
      expect(withdrawn.status).toBe('WITHDRAWN');
      const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(final.refundedAmount.toFixed(4)).toBe('0.0000');
      expect(final.manualReviewReason).toBeNull();
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe(payableBefore);
      // A new return is possible again.
      const again = await returns.createReturn({ orderId: order.id, reason: 'retry', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-refuse-2' });
      expect(again.status).toBe('AWAITING_SHORTFALL_SETTLEMENT');
      await returns.settleShortfall(again.id, setup.staff.id, '0');
    });

    it('online: REOPEN shows the desk the amounts as they are now — also for a pre-Q9 (7e44ad8) row, whose old order flag is cleared', async () => {
      const setup = await partnerSetup({ rateBps: 2000 });
      const customer = await s.customer();
      const order = await complete(setup, customer.user.id, {}, '50000');
      await spendGreen(customer.user.id, '1700');
      const pending = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-legacy' });
      // Exactly what 7e44ad8 left behind for a shortfall return: MANUAL_REVIEW,
      // nothing moved, no Q9 breakdown, the order flagged 'return_shortfall'.
      await prisma.partnerOrderReturn.update({
        where: { id: pending.id },
        data: {
          status: 'MANUAL_REVIEW',
          manualReviewReason: 'return_shortfall',
          ...Object.fromEntries(
            [
              'tutakMoneyGross', 'tutakMoneyRefunded', 'externalRefundGross', 'externalRefundDue', 'shortfallFromMoney',
              'shortfallFromExternal', 'shortfallCollected', 'recoveredShortfall', 'grossRefund', 'netRefund',
            ].map((k) => [k, 0]),
          ),
        },
      });
      await prisma.partnerOrder.update({ where: { id: order.id }, data: { manualReviewAt: new Date(), manualReviewReason: 'return_shortfall' } });
      // The customer spends a little more while the return waits for TuTak.
      await spendGreen(customer.user.id, '100');

      const reopened = await returns.reviewShortfall(pending.id, setup.admin.id, 'REOPEN', 'Customer agreed to the netting');
      expect(reopened.status).toBe('AWAITING_SHORTFALL_SETTLEMENT');
      expect(reopened.grossRefund.toFixed(4)).toBe('50000.0000');
      expect(reopened.shortfallFromExternal.toFixed(4)).toBe('1800.0000');
      expect(reopened.netRefund.toFixed(4)).toBe('48200.0000');
      const flagged = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(flagged.manualReviewReason).toBeNull();
      expect(flagged.manualReviewAt).toBeNull();
      // The dry run moved nothing.
      expect(flagged.refundedAmount.toFixed(4)).toBe('0.0000');

      const done = await returns.settleShortfall(pending.id, setup.staff.id, '0');
      expect(done.status).toBe('COMPLETED');
      expect(done.recoveredShortfall.toFixed(4)).toBe('1800.0000');
    });

    it('online: if the customer spent more meanwhile, nothing moves and the new amounts are shown for re-confirmation', async () => {
      const setup = await partnerSetup({ rateBps: 2000 });
      const customer = await s.customer();
      const order = await complete(setup, customer.user.id, {}, '50000');
      await spendGreen(customer.user.id, '1700');
      const pending = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'q9-change' });
      expect(pending.shortfallFromExternal.toFixed(4)).toBe('1700.0000');
      await spendGreen(customer.user.id, '100');
      await expect(returns.settleShortfall(pending.id, setup.staff.id, '0')).rejects.toThrow(/changed/);
      const updated = await prisma.partnerOrderReturn.findUniqueOrThrow({ where: { id: pending.id } });
      expect(updated.status).toBe('AWAITING_SHORTFALL_SETTLEMENT');
      expect(updated.shortfallFromExternal.toFixed(4)).toBe('1800.0000');
      const done = await returns.settleShortfall(pending.id, setup.staff.id, '0');
      expect(done.recoveredShortfall.toFixed(4)).toBe('1800.0000');
    });

    it('QR, COMMERCE_V2: new purchases carry the policy; the refund nets the spent green from the TuTak-money part', async () => {
      const shop = await createPartner(prisma, { bonusAccrualRateBps: 2000 });
      const cashier = await s.staff(shop.id);
      const customer = await s.customer('60000');
      const intent = await intents.create({ partnerId: shop.id, grossAmount: '50000', tutakMoneyAmount: '50000' }, customer.user.id);
      expect((await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).financialPolicyVersion).toBe('COMMERCE_V2');
      await intents.confirm(intent.id, cashier.id);
      await spendGreen(customer.user.id, '1700');
      const result = await qrRefunds.refund({ purchaseIntentId: intent.id, reason: 'returned', actorId: cashier.id, idempotencyKey: 'qr-net' });
      expect(result.status).toBe('COMPLETED');
      expect(result.grossRefund).toBe('50000.0000');
      expect(result.recoveredShortfall).toBe('1700.0000');
      expect(result.netRefund).toBe('48300.0000');
      const row = await prisma.purchaseIntentRefund.findUniqueOrThrow({ where: { id: result.refundId } });
      expect(row.financialPolicyVersion).toBe('COMMERCE_V2');
      expect(row.shortfallFromMoney.toFixed(4)).toBe('1700.0000');
    });

    it('QR, COMMERCE_V2: a cash purchase settles the shortfall at the desk, then executes', async () => {
      const shop = await createPartner(prisma, { bonusAccrualRateBps: 2000 });
      const cashier = await s.staff(shop.id);
      const customer = await s.customer('20000');
      const intent = await intents.create({ partnerId: shop.id, grossAmount: '50000' }, customer.user.id);
      await intents.confirm(intent.id, cashier.id);
      await spendGreen(customer.user.id, '1700');
      const payableBefore = await s.balance(A.PARTNER_PAYABLE, { partnerId: shop.id });
      const pending = await qrRefunds.refund({ purchaseIntentId: intent.id, reason: 'returned', actorId: cashier.id, idempotencyKey: 'qr-desk' });
      expect(pending.status).toBe('AWAITING_SHORTFALL_SETTLEMENT');
      expect(pending.cashRefundNet).toBe('48300.0000');
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: shop.id })).toBe(payableBefore);
      // A replay of the same request returns the same pending refund.
      const replay = await qrRefunds.refund({ purchaseIntentId: intent.id, reason: 'returned', actorId: cashier.id, idempotencyKey: 'qr-desk' });
      expect(replay.refundId).toBe(pending.refundId);
      const done = await qrRefunds.settleShortfall(pending.refundId, cashier.id, '0');
      expect(done.status).toBe('COMPLETED');
      expect(done.recoveredShortfall).toBe('1700.0000');
      expect(done.totalRefunded).toBe('50000.0000');
    });

    it('QR, LEGACY_V1: an old purchase keeps the old rule — nothing withheld, nothing netted, no desk step', async () => {
      const shop = await createPartner(prisma, { bonusAccrualRateBps: 2000 });
      const cashier = await s.staff(shop.id);
      const customer = await s.customer('60000');
      const { user: referrer } = await createCustomer(prisma);
      await invite(customer.user.id, { type: 'USER', userId: referrer.id });
      const intent = await intents.create({ partnerId: shop.id, grossAmount: '50000', tutakMoneyAmount: '50000' }, customer.user.id);
      // Created before the effective date: stamped LEGACY_V1 (simulated on the row).
      await prisma.purchaseIntent.update({ where: { id: intent.id }, data: { financialPolicyVersion: 'LEGACY_V1' } });
      await intents.confirm(intent.id, cashier.id);
      await spendGreen(customer.user.id, '1700');
      await spendGreen(referrer.id, '900');
      const result = await qrRefunds.refund({ purchaseIntentId: intent.id, reason: 'returned', actorId: cashier.id, idempotencyKey: 'qr-legacy' });
      expect(result.status).toBe('COMPLETED');
      expect(result.recoveredShortfall).toBe('0.0000');
      expect(result.tutakMoneyRefunded).toBe('50000.0000');
      expect(await prisma.referralWithholding.count()).toBe(0);
      const row = await prisma.purchaseIntentRefund.findUniqueOrThrow({ where: { id: result.refundId } });
      expect(row.financialPolicyVersion).toBe('LEGACY_V1');
    });
  });

  // ── Q10 ───────────────────────────────────────────────────────────────────

  describe('Q10 — received while an external payment is pending', () => {
    it('saves the receipt, keeps escrow, distributes nothing, flags Payment issue at once; confirmation completes', async () => {
      const setup = await partnerSetup({ rateBps: 500 });
      const customer = await s.customer('50000');
      const created = await orders.create(setup.partner.id, setup.integrationId, orderDto('Q10-1'));
      const submitted = await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '10000', idempotencyKey: 'q10-1' });
      await orders.confirmStock(created.id, setup.staff.id);
      await orders.markDelivered(created.id, setup.staff.id);
      const received = await orders.confirmReceived(created.id, customer.user.id);
      expect(received.operationalStatus).toBe('RECEIVED');
      expect(received.customerReceivedAt).not.toBeNull();
      expect(received.paymentIssueAt).not.toBeNull();
      expect(await s.escrow(setup.partner.id)).toBe('-10000.0000');
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(0);
      expect(await prisma.orderEscalation.count({ where: { orderId: created.id, type: 'PAYMENT_ISSUE', resolvedAt: null } })).toBe(1);
      const queue = await orders.listAdminQueue('payment_issue');
      expect(queue.map((o) => o.id)).toContain(created.id);

      // 24h later, still unconfirmed → escalated once more (once).
      await prisma.partnerOrder.update({ where: { id: created.id }, data: { paymentIssueAt: new Date(Date.now() - 25 * HOUR) } });
      expect(await sla.sweepPaymentIssues()).toBe(1);
      expect(await sla.sweepPaymentIssues()).toBe(0);
      expect(await prisma.orderEscalation.count({ where: { orderId: created.id, type: 'PAYMENT_ISSUE_24H' } })).toBe(1);

      const external = submitted.paymentLegs.find((l) => l.type === 'EXTERNAL')!;
      const done = await orders.confirmExternalPayment(external.id, setup.staff.id);
      expect(done.operationalStatus).toBe('COMPLETED');
      expect(await s.escrow(setup.partner.id)).toBe('0.0000');
      expect(await prisma.orderEscalation.count({ where: { orderId: created.id, resolvedAt: null } })).toBe(0);
      await s.assertOrderInvariants(created.id);
    });
  });

  // ── Q13 ───────────────────────────────────────────────────────────────────

  describe('Q13 — only real money satisfies the minimum prepayment', () => {
    it('20000 green does not cover a 20000 prepayment; 20000 TuTak money does', async () => {
      const setup = await partnerSetup({ rateBps: 500 });
      await rules.createPrepaymentRule({ partnerId: setup.partner.id, mode: 'PERCENT', percentBps: 2000, actorUserId: setup.admin.id });
      const customer = await s.customer('20000', '20000');
      const created = await orders.create(setup.partner.id, setup.integrationId, orderDto('Q13-1', '100000'));
      const checkout = await orders.getCheckout(created.id, customer.user.id);
      expect(checkout.limits.prepaymentRequiredAmount).toBe('20000.0000');
      expect(checkout.limits.prepaymentCountsFrom).toBe('TUTAK_MONEY');

      await expect(
        orders.submit(created.id, customer.user.id, { discountAmount: '20000', idempotencyKey: 'q13-a' }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ error: 'PREPAYMENT_REQUIRED' }) });
      await expect(
        orders.submit(created.id, customer.user.id, { discountAmount: '20000', tutakMoneyAmount: '10000', idempotencyKey: 'q13-b' }),
      ).rejects.toThrow(/discount balance does not count/);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('20000.0000');

      const ok = await orders.submit(created.id, customer.user.id, { discountAmount: '20000', tutakMoneyAmount: '20000', idempotencyKey: 'q13-c' });
      expect(ok.operationalStatus).toBe('SUBMITTED');
      expect(ok.prepaymentCoveredAmount.toFixed(4)).toBe('20000.0000');
      expect(ok.discountAmount.toFixed(4)).toBe('20000.0000');
    });
  });

  // ── Item 7 ────────────────────────────────────────────────────────────────

  describe('delivery split — a courier handoff never starts the customer timers', () => {
    it('OUT_FOR_DELIVERY / READY_FOR_PICKUP: no reminder, no manual review however long; DELIVERED: 24h / 48h', async () => {
      const setup = await partnerSetup();
      const customer = await s.customer('100000');
      const courier = await orders.create(setup.partner.id, setup.integrationId, orderDto('D-courier'));
      await orders.submit(courier.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'd-c' });
      await orders.confirmStock(courier.id, setup.staff.id);
      const out = await orders.markOutForDelivery(courier.id, setup.staff.id, 'Courier Aram +374 99 000000');
      expect(out.operationalStatus).toBe('OUT_FOR_DELIVERY');
      expect(out.fulfillmentMethod).toBe('DELIVERY');
      expect(out.courierNote).toBe('Courier Aram +374 99 000000');
      expect(out.deliveredAt).toBeNull();

      const pickup = await orders.create(setup.partner.id, setup.integrationId, orderDto('D-pickup'));
      await orders.submit(pickup.id, customer.user.id, { tutakMoneyAmount: '30000', idempotencyKey: 'd-p' });
      await orders.confirmStock(pickup.id, setup.staff.id);
      expect((await orders.markReadyForPickup(pickup.id, setup.staff.id)).operationalStatus).toBe('READY_FOR_PICKUP');

      const threeDaysAgo = new Date(Date.now() - 72 * HOUR);
      await prisma.partnerOrder.updateMany({
        where: { id: { in: [courier.id, pickup.id] } },
        data: { stockConfirmedAt: threeDaysAgo, outForDeliveryAt: threeDaysAgo, readyForPickupAt: threeDaysAgo },
      });
      expect(await sla.sweepReceipt()).toEqual({ reminded: 0, manualReview: 0 });

      await orders.markDelivered(courier.id, setup.staff.id);
      await prisma.partnerOrder.update({ where: { id: courier.id }, data: { deliveredAt: new Date(Date.now() - 25 * HOUR) } });
      expect(await sla.sweepReceipt()).toEqual({ reminded: 1, manualReview: 0 });
      await prisma.partnerOrder.update({ where: { id: courier.id }, data: { deliveredAt: new Date(Date.now() - 49 * HOUR) } });
      expect(await sla.sweepReceipt()).toEqual({ reminded: 0, manualReview: 1 });
      const reviewed = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: courier.id } });
      expect(reviewed.manualReviewReason).toBe('receipt_not_confirmed_48h');
      // Never released on a timer.
      expect(await s.escrow(setup.partner.id)).toBe('-60000.0000');
      // The customer may confirm from any of the post-stock states.
      expect((await orders.confirmReceived(pickup.id, customer.user.id)).operationalStatus).toBe('COMPLETED');
    });
  });

  // ── Item 8 ────────────────────────────────────────────────────────────────

  describe('cancellation — only an actual, disclosed, admin-approved cost; never a penalty', () => {
    const TERMS = 'Если курьер уже выехал, фактическая стоимость доставки не возвращается';

    async function orderWithTerms(setup: Awaited<ReturnType<typeof partnerSetup>>, customerId: string, split: { money?: string; discount?: string }, price = '35000') {
      const created = await orders.create(setup.partner.id, setup.integrationId, orderDto(`C-${Math.random()}`, price, { cancellationTerms: TERMS }));
      const submitted = await orders.submit(created.id, customerId, { tutakMoneyAmount: split.money, discountAmount: split.discount, idempotencyKey: `c-${created.id}` });
      return { created, submitted };
    }

    it('before stock is confirmed a cancellation is immediate and full, terms or not', async () => {
      const setup = await partnerSetup();
      const customer = await s.customer('50000');
      const { created } = await orderWithTerms(setup, customer.user.id, { money: '35000' });
      const cancelled = await cancellations.request(created.id, customer.user.id, 'changed my mind');
      expect(cancelled.operationalStatus).toBe('CANCELLED');
      expect(await prisma.partnerOrderCancellation.count()).toBe(0);
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
    });

    it('claim → reduce: kept from confirmed external cash first; money and discount back in full; no commission', async () => {
      const setup = await partnerSetup();
      const customer = await s.customer('50000', '6000');
      const { created, submitted } = await orderWithTerms(setup, customer.user.id, { money: '20000', discount: '5000' });
      const external = submitted.paymentLegs.find((l) => l.type === 'EXTERNAL')!;
      await orders.confirmExternalPayment(external.id, setup.staff.id);
      await orders.confirmStock(created.id, setup.staff.id);
      await orders.markOutForDelivery(created.id, setup.staff.id);

      const requested = await cancellations.request(created.id, customer.user.id, 'no longer needed');
      expect(requested.operationalStatus).toBe('OUT_FOR_DELIVERY');
      expect(requested.cancellationStatus).toBe('REQUESTED');
      // Fulfilment and receipt pause while the request is open.
      await expect(orders.markDelivered(created.id, setup.staff.id)).rejects.toMatchObject({ response: expect.objectContaining({ error: 'CANCELLATION_PENDING' }) });
      await expect(orders.confirmReceived(created.id, customer.user.id)).rejects.toMatchObject({ response: expect.objectContaining({ error: 'CANCELLATION_PENDING' }) });
      // Idempotent.
      expect((await cancellations.request(created.id, customer.user.id)).cancellationStatus).toBe('REQUESTED');

      const claimed = await cancellations.claimCost(created.id, setup.staff.id, { amount: '3000', reason: 'Courier already dispatched', evidence: 'Courier invoice #77' });
      expect(claimed.cancellationStatus).toBe('COST_REVIEW');
      expect(await prisma.orderEscalation.count({ where: { orderId: created.id, type: 'CANCELLATION_COST_REVIEW', resolvedAt: null } })).toBe(1);
      const req = await prisma.partnerOrderCancellation.findFirstOrThrow({ where: { orderId: created.id } });
      await expect(cancellations.decide(req.id, setup.admin.id, { decision: 'REDUCE', approvedAmount: '3000', note: 'x' })).rejects.toThrow(/below the claim/);

      const decided = await cancellations.decide(req.id, setup.admin.id, { decision: 'REDUCE', approvedAmount: '2000', note: 'Invoice shows 2000' });
      expect(decided.decision).toBe('REDUCED');
      expect(decided.approvedCostAmount.toFixed(4)).toBe('2000.0000');
      expect(decided.costFromExternal.toFixed(4)).toBe('2000.0000');
      expect(decided.costFromMoney.toFixed(4)).toBe('0.0000');
      const order = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id }, include: { paymentLegs: true } });
      expect(order.operationalStatus).toBe('CANCELLED');
      expect(order.paymentStatus).toBe('REFUND_PENDING');
      const cashLeg = order.paymentLegs.find((l) => l.type === 'EXTERNAL')!;
      expect(cashLeg.status).toBe('RETURN_PENDING');
      expect(cashLeg.retainedAmount.toFixed(4)).toBe('2000.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-50000.0000');
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('6000.0000');
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(0);
      expect(await prisma.orderEscalation.count({ where: { orderId: created.id, resolvedAt: null } })).toBe(0);
      await orders.confirmExternalReturn(cashLeg.id, setup.staff.id);
      expect((await prisma.partnerOrder.findUniqueOrThrow({ where: { id: created.id } })).paymentStatus).toBe('REFUNDED');
      const actions = (await prisma.auditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'PARTNER_ORDER_CANCELLATION_REQUESTED',
          'PARTNER_ORDER_CANCELLATION_COST_CLAIMED',
          'PARTNER_ORDER_CANCELLATION_DECIDED',
          'PARTNER_ORDER_CANCELLED',
        ]),
      );
      await s.assertOrderInvariants(created.id);
    });

    it('approve from the money escrow; capped by the real money on the order; the customer is never charged beyond it', async () => {
      const setup = await partnerSetup({ maxBonusPaymentPercent: 100 });
      const customer = await s.customer('10000', '30000');
      const { created } = await orderWithTerms(setup, customer.user.id, { money: '5000', discount: '30000' });
      await orders.confirmStock(created.id, setup.staff.id);
      await cancellations.request(created.id, customer.user.id);
      await cancellations.claimCost(created.id, setup.staff.id, { amount: '8000', reason: 'Special preparation' });
      const req = await prisma.partnerOrderCancellation.findFirstOrThrow({ where: { orderId: created.id } });
      expect(await cancellations.costCap(created.id)).toEqual({ external: '0.0000', money: '5000.0000', total: '5000.0000' });
      await expect(cancellations.decide(req.id, setup.admin.id, { decision: 'APPROVE', note: 'ok' })).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'COST_EXCEEDS_REAL_MONEY' }),
      });
      const decided = await cancellations.decide(req.id, setup.admin.id, { decision: 'REDUCE', approvedAmount: '5000', note: 'All the real money there is' });
      expect(decided.costFromMoney.toFixed(4)).toBe('5000.0000');
      // 5000 went from the money escrow to the partner; the 30000 discount went back as discount.
      expect(await s.balance(A.PARTNER_PAYABLE, { partnerId: setup.partner.id })).toBe('-5000.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-5000.0000');
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('30000.0000');
      const costTx = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'partner_order.cancellation_cost' },
        include: { postings: { include: { account: true } } },
      });
      expect(costTx.sourceId).toBe(req.id);
      expect(costTx.postings.map((p) => `${p.account.type}:${p.direction}`).sort()).toEqual([
        'PARTNER_ORDER_MONEY_ESCROW:DEBIT',
        'PARTNER_PAYABLE:CREDIT',
      ]);
      await s.assertOrderInvariants(created.id);
    });

    it('reject, "no costs", an unanswered window and a withdrawal', async () => {
      const setup = await partnerSetup();
      const customer = await s.customer('200000');

      const a = await orderWithTerms(setup, customer.user.id, { money: '35000' });
      await orders.confirmStock(a.created.id, setup.staff.id);
      await cancellations.request(a.created.id, customer.user.id);
      await cancellations.claimCost(a.created.id, setup.staff.id, { amount: '1000', reason: 'Packaging' });
      const reqA = await prisma.partnerOrderCancellation.findFirstOrThrow({ where: { orderId: a.created.id } });
      const rejected = await cancellations.decide(reqA.id, setup.admin.id, { decision: 'REJECT', note: 'Not a disclosed cost' });
      expect(rejected.approvedCostAmount.toFixed(4)).toBe('0.0000');
      await expect(cancellations.decide(reqA.id, setup.admin.id, { decision: 'APPROVE', note: 'again' })).rejects.toThrow(/not waiting/);

      const b = await orderWithTerms(setup, customer.user.id, { money: '35000' });
      await orders.confirmStock(b.created.id, setup.staff.id);
      await cancellations.request(b.created.id, customer.user.id);
      expect((await cancellations.declareNoCost(b.created.id, setup.staff.id)).operationalStatus).toBe('CANCELLED');

      const c = await orderWithTerms(setup, customer.user.id, { money: '35000' });
      await orders.confirmStock(c.created.id, setup.staff.id);
      await cancellations.request(c.created.id, customer.user.id);
      await prisma.partnerOrderCancellation.updateMany({ where: { orderId: c.created.id }, data: { partnerDeadlineAt: new Date(Date.now() - 1000) } });
      expect(await sla.expireCancellationClaims()).toBe(1);
      const reqC = await prisma.partnerOrderCancellation.findFirstOrThrow({ where: { orderId: c.created.id } });
      expect(reqC.decision).toBe('NO_CLAIM');
      expect((await prisma.partnerOrder.findUniqueOrThrow({ where: { id: c.created.id } })).operationalStatus).toBe('CANCELLED');

      const d = await orderWithTerms(setup, customer.user.id, { money: '35000' });
      await orders.confirmStock(d.created.id, setup.staff.id);
      await cancellations.request(d.created.id, customer.user.id);
      const resumed = await cancellations.withdraw(d.created.id, customer.user.id);
      expect(resumed.cancellationStatus).toBe('NONE');
      await orders.markDelivered(d.created.id, setup.staff.id);
      expect((await orders.confirmReceived(d.created.id, customer.user.id)).operationalStatus).toBe('COMPLETED');

      // 3 × 35000 back, 1 × 35000 spent.
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-165000.0000');
      for (const o of [a, b, c, d]) await s.assertOrderInvariants(o.created.id);
    });

    it('two admins deciding at once produce exactly one decision', async () => {
      const setup = await partnerSetup();
      const customer = await s.customer('50000');
      const { created } = await orderWithTerms(setup, customer.user.id, { money: '35000' });
      await orders.confirmStock(created.id, setup.staff.id);
      await cancellations.request(created.id, customer.user.id);
      await cancellations.claimCost(created.id, setup.staff.id, { amount: '1000', reason: 'Delivery' });
      const req = await prisma.partnerOrderCancellation.findFirstOrThrow({ where: { orderId: created.id } });
      const results = await Promise.allSettled([
        cancellations.decide(req.id, setup.admin.id, { decision: 'APPROVE', note: 'a' }),
        cancellations.decide(req.id, setup.admin.id, { decision: 'REJECT', note: 'b' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner_order.money_return' } })).toBe(1);
      await s.assertOrderInvariants(created.id);
    });
  });

  // ── Item 9 ────────────────────────────────────────────────────────────────

  describe('escrow provenance — discount only ever back to the discount balance, money only to the money balance', () => {
    it('cancel of a mixed order: each escrow returns exactly its own source, nothing crosses', async () => {
      const setup = await partnerSetup();
      const customer = await s.customer('20000', '8000');
      const created = await orders.create(setup.partner.id, setup.integrationId, orderDto('P-1'));
      await orders.submit(created.id, customer.user.id, { discountAmount: '7000', tutakMoneyAmount: '13000', idempotencyKey: 'p-1' });
      expect(await s.balance(A.PARTNER_ORDER_DISCOUNT_ESCROW, { partnerId: setup.partner.id })).toBe('-7000.0000');
      expect(await s.balance(A.PARTNER_ORDER_MONEY_ESCROW, { partnerId: setup.partner.id })).toBe('-13000.0000');
      await cancellations.request(created.id, customer.user.id);
      expect(await s.balance(A.PARTNER_ORDER_DISCOUNT_ESCROW, { partnerId: setup.partner.id })).toBe('0.0000');
      expect(await s.balance(A.PARTNER_ORDER_MONEY_ESCROW, { partnerId: setup.partner.id })).toBe('0.0000');
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-20000.0000');
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      expect(wallet.availableBonus.toFixed(4)).toBe('8000.0000');
      const discountReturn = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'partner_order.discount_return' },
        include: { postings: { include: { account: true } } },
      });
      expect(discountReturn.postings.map((p) => p.account.type).sort()).toEqual(['BONUS_LIABILITY', 'PARTNER_ORDER_DISCOUNT_ESCROW']);
      const moneyReturn = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'partner_order.money_return' },
        include: { postings: { include: { account: true } } },
      });
      expect(moneyReturn.postings.map((p) => p.account.type).sort()).toEqual(['CUSTOMER_PREPAID_BALANCE', 'PARTNER_ORDER_MONEY_ESCROW']);
    });

    it('completion and return of a mixed order: provenance holds through release and reversal', async () => {
      const setup = await partnerSetup({ rateBps: 1000 });
      const customer = await s.customer('20000', '8000');
      const order = await complete(setup, customer.user.id, { discount: '7000', money: '13000' }, '30000');
      const completion = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'partner_order.completion', sourceId: order.id },
        include: { postings: { include: { account: true } } },
      });
      expect(completion.postings.map((p) => `${p.account.type}:${p.direction}:${p.amount.toFixed(0)}`).sort()).toEqual([
        'PARTNER_ORDER_DISCOUNT_ESCROW:DEBIT:7000',
        'PARTNER_ORDER_MONEY_ESCROW:DEBIT:13000',
        'PARTNER_PAYABLE:CREDIT:20000',
      ]);
      const ret = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 'p-2' });
      expect(ret.status).toBe('PENDING_EXTERNAL_REFUND');
      expect(ret.discountRestored.toFixed(4)).toBe('7000.0000');
      expect(ret.tutakMoneyRefunded.toFixed(4)).toBe('13000.0000');
      await returns.confirmExternalRefund(ret.id, setup.staff.id);
      expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-20000.0000');
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.user.id } });
      // The 7000 discount came back as discount; the order's own green (600) was reversed.
      expect(wallet.availableBonus.toFixed(4)).toBe('8000.0000');
    });
  });
});
