import { LedgerAccountType as A, PartnerSettlementStatus, PostingDirection, PrismaClient, SettlementPeriodicity } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PartnerOrdersService } from '../src/modules/partner-orders/partner-orders.service';
import { PartnerOrderReturnsService } from '../src/modules/partner-orders/partner-order-returns.service';
import { PartnerOrderCancellationService } from '../src/modules/partner-orders/partner-order-cancellation.service';
import { OrderDisputesService } from '../src/modules/partner-orders/order-disputes.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { periodContaining, lastClosedPeriod } from '../src/modules/partner-settlements/settlement-period';
import { PartnerSettlementStatementService } from '../src/modules/payouts/partner-settlement-statement.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { commerceSupport, orderDto } from './support/commerce';

/**
 * Partner Commerce × the one settlement engine (docs/PARTNER_COMMERCE.md §14).
 *
 * `PartnerSettlementService` (main) is the only thing that pays a partner:
 * a posting is paid when a `PartnerSettlementEntry` claims it, at most once
 * (unique `ledgerPostingId`). These tests drive real Partner Commerce flows
 * on real PostgreSQL and prove that what the engine claims is exactly the
 * partner's economics — the electronic part, minus commission, minus
 * refunds, plus Q8/Q9 effects, never a disputed amount, never external cash
 * twice — and that PARTNER_PAYABLE is always explained by claimed + unclaimed
 * settleable postings.
 */
describe('Partner Commerce — settlement through PartnerSettlementService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let orders: PartnerOrdersService;
  let returns: PartnerOrderReturnsService;
  let cancellations: PartnerOrderCancellationService;
  let disputes: OrderDisputesService;
  let intents: PurchaseIntentsService;
  let engine: PartnerSettlementService;
  let statements: PartnerSettlementStatementService;
  let ledger: LedgerService;
  let s: ReturnType<typeof commerceSupport>;
  let maker = '';
  let checker = '';

  const savedTopUpFlag = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;

  beforeAll(async () => {
    // Real TuTak money through the real top-up flow (off by default on main).
    process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = 'true';
    harness = await createTestHarness();
    prisma = harness.prisma;
    orders = harness.app.get(PartnerOrdersService);
    returns = harness.app.get(PartnerOrderReturnsService);
    cancellations = harness.app.get(PartnerOrderCancellationService);
    disputes = harness.app.get(OrderDisputesService);
    intents = harness.app.get(PurchaseIntentsService);
    engine = harness.app.get(PartnerSettlementService);
    statements = harness.app.get(PartnerSettlementStatementService);
    ledger = harness.app.get(LedgerService);
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
    maker = (await createStaffUser(prisma)).id;
    checker = (await createStaffUser(prisma)).id;
  });

  afterEach(async () => {
    await s.assertAllAccountsReplay();
  });

  async function partnerSetup(opts: { rateBps?: number; maxBonusPaymentPercent?: number; periodicity?: SettlementPeriodicity } = {}) {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: opts.rateBps ?? 500, maxBonusPaymentPercent: opts.maxBonusPaymentPercent });
    const admin = await createStaffUser(prisma);
    const integrationId = await s.websiteIntegration(partner.id, admin.id);
    const staff = await s.staff(partner.id);
    await prisma.partnerBankAccount.create({
      data: { partnerId: partner.id, beneficiaryName: 'ООО Партнёр', accountNumber: 'AM00 1111', bankName: 'Тестбанк', createdByUserId: admin.id },
    });
    await engine.setPeriodicity({ partnerId: partner.id, periodicity: opts.periodicity ?? SettlementPeriodicity.DAILY, anchorDay: 1, actorId: admin.id });
    return { partner, admin, integrationId, staff };
  }
  type Setup = Awaited<ReturnType<typeof partnerSetup>>;

  async function complete(setup: Setup, customerId: string, split: { money?: string; discount?: string }, unitPrice: string) {
    const created = await orders.create(setup.partner.id, setup.integrationId, orderDto(`S-${Math.random()}`, unitPrice));
    const submitted = await orders.submit(created.id, customerId, { tutakMoneyAmount: split.money, discountAmount: split.discount, idempotencyKey: `k-${created.id}` });
    const external = submitted.paymentLegs.find((l) => l.type === 'EXTERNAL');
    if (external) await orders.confirmExternalPayment(external.id, setup.staff.id);
    await orders.confirmStock(created.id, setup.staff.id);
    await orders.markDelivered(created.id, setup.staff.id);
    return orders.confirmReceived(created.id, customerId);
  }

  /** A draft for the period of the partner's cadence that contains now — closed by moving the clock past its end. */
  async function draftCurrentPeriod(partnerId: string) {
    const p = await prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });
    const current = periodContaining(p.settlementPeriodicity, p.settlementAnchorDay, new Date());
    return engine.createDraftForClosedPeriod({ partnerId, actorId: maker, now: new Date(current.end.getTime() + 1) });
  }

  async function pay(settlementId: string, ref = `BANK-${Math.random().toString(36).slice(2, 8)}`) {
    await engine.markReady(settlementId, { actorId: maker, documentNumber: 'ФАКТУРА' });
    await engine.approve(settlementId, checker);
    return engine.markPaid(settlementId, { actorId: checker, bankTransferReference: ref });
  }

  const owedToPartner = async (partnerId: string) => new Decimal(await s.balance(A.PARTNER_PAYABLE, { partnerId })).negated();

  /**
   * PARTNER_PAYABLE is always explained: what TuTak owes the partner equals
   * the unclaimed settleable net plus what non-paid settlements already
   * claimed — with no unclassified kind anywhere.
   */
  async function assertExplained(partnerId: string) {
    const unsettled = await engine.unsettled(partnerId);
    expect(unsettled.unrecognised).toEqual([]);
    const open = await prisma.partnerSettlement.findMany({
      where: { partnerId, status: { notIn: [PartnerSettlementStatus.PAID, PartnerSettlementStatus.CANCELLED] } },
    });
    const claimedUnpaid = open.reduce((sum, st) => sum.plus(st.netPayableAmount), new Decimal(0));
    expect((await owedToPartner(partnerId)).toFixed(4)).toBe(unsettled.net.plus(claimedUnpaid).toFixed(4));
    return unsettled;
  }

  const kindsOf = async (settlementId: string) =>
    (await prisma.partnerSettlementEntry.findMany({ where: { settlementId } })).map((e) => `${e.kind}:${e.direction}:${e.amount.toFixed(0)}`).sort();

  // ── 1-3: electronic receivable, mixed payment, commission ──────────────────

  it('1: online order → received → the electronic receivable minus commission is settled and paid', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('50000');
    const order = await complete(setup, customer.user.id, { money: '30000' }, '30000');
    expect(order.operationalStatus).toBe('COMPLETED');
    await assertExplained(setup.partner.id);

    const draft = await draftCurrentPeriod(setup.partner.id);
    expect(draft.netPayableAmount.toFixed(4)).toBe('28500.0000');
    expect(await kindsOf(draft.id)).toEqual(['partner.contribution:DEBIT:1500', 'partner_order.completion:CREDIT:30000']);
    const paid = await pay(draft.id);
    expect(paid.status).toBe('PAID');
    expect((await owedToPartner(setup.partner.id)).toFixed(4)).toBe('0.0000');
    await assertExplained(setup.partner.id);
  });

  it('2+3: mixed payment — only the electronic part is paid, external cash never twice; commission on the full total', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('50000', '6000');
    // 30000 = 10000 TuTak money + 5000 discount + 15000 cash to the partner.
    await complete(setup, customer.user.id, { money: '10000', discount: '5000' }, '30000');
    const draft = await draftCurrentPeriod(setup.partner.id);
    // Electronic 15000 − commission 5% of 30000 = 13500. The 15000 cash is already the partner's.
    expect(await kindsOf(draft.id)).toEqual(['partner.contribution:DEBIT:1500', 'partner_order.completion:CREDIT:15000']);
    expect(draft.netPayableAmount.toFixed(4)).toBe('13500.0000');
    await pay(draft.id);
    await assertExplained(setup.partner.id);
  });

  // ── 4-5: refunds before and after settlement ────────────────────────────

  it('4: a refund before settlement is deducted in the same settlement', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('50000');
    const order = await complete(setup, customer.user.id, { money: '30000' }, '30000');
    await returns.createReturn({ orderId: order.id, amount: '12000', reason: 'partial', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 's4' });
    const draft = await draftCurrentPeriod(setup.partner.id);
    // 30000 − 1500 − 12000 (money back to the customer) + 600 (commission on 12000 reversed).
    expect(draft.netPayableAmount.toFixed(4)).toBe('17100.0000');
    expect(await kindsOf(draft.id)).toEqual([
      'partner.contribution:DEBIT:1500',
      'partner.contribution_refund:CREDIT:600',
      'partner_order.completion:CREDIT:30000',
      'partner_order.return_money:DEBIT:12000',
    ]);
    await assertExplained(setup.partner.id);
  });

  it('5: a refund after a paid settlement is partner debt, netted against the next period — the PAID settlement is untouched', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('90000');
    const first = await complete(setup, customer.user.id, { money: '30000' }, '30000');
    const paid = await pay((await draftCurrentPeriod(setup.partner.id)).id);
    expect(paid.netPayableAmount.toFixed(4)).toBe('28500.0000');

    await returns.createReturn({ orderId: first.id, reason: 'defective', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 's5' });
    expect((await owedToPartner(setup.partner.id)).toFixed(4)).toBe('-28500.0000');
    // Nothing to pay: the debt stays unclaimed and waits for future earnings.
    await expect(draftCurrentPeriod(setup.partner.id)).rejects.toThrow(/Nothing to pay/);
    await assertExplained(setup.partner.id);

    await complete(setup, customer.user.id, { money: '40000' }, '40000');
    const next = await draftCurrentPeriod(setup.partner.id);
    // 40000 − 2000 − 30000 + 1500 = 9500: the debt is netted.
    expect(next.netPayableAmount.toFixed(4)).toBe('9500.0000');
    expect(await kindsOf(next.id)).toEqual(
      expect.arrayContaining(['partner_order.return_money:DEBIT:30000', 'partner.contribution_refund:CREDIT:1500']),
    );
    const untouched = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: paid.id } });
    expect(untouched.status).toBe('PAID');
    expect(untouched.netPayableAmount.toFixed(4)).toBe('28500.0000');
    await assertExplained(setup.partner.id);
  });

  // ── 6-7: Q8 and Q9 ───────────────────────────────────────────────────────

  it('6: a Q8 withholding repaid later reaches the partner in a later settlement', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('100000');
    const { user: referrer } = await createCustomer(prisma);
    await prisma.referralCode.create({ data: { userId: referrer.id, code: `TT-${referrer.id.slice(0, 8)}` } });
    await prisma.referralInvite.create({ data: { referrerType: 'USER', referrerUserId: referrer.id, refereeUserId: customer.user.id } });
    // 40000 at 5% → pool 2000 → L1 200; the referrer spends 150 of it elsewhere.
    const returned = await complete(setup, customer.user.id, { money: '40000' }, '40000');
    const elsewhere = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const elsewhereStaff = await s.staff(elsewhere.id);
    const spend = await intents.create({ partnerId: elsewhere.id, grossAmount: '10000', bonusAmountRequested: '150' }, referrer.id);
    await intents.confirm(spend.id, elsewhereStaff.id);
    await returns.createReturn({ orderId: returned.id, reason: 'defective', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 's6' });
    // Another, un-referred customer's order (a referred one would pay the
    // referrer a new share, which repays the withholding at once).
    const other = await s.customer('50000');
    await complete(setup, other.user.id, { money: '30000' }, '30000');

    // Settlement 1: 40000 − 2000 − 40000 + (2000 − 150 withheld) + 28500 = 28350.
    const first = await pay((await draftCurrentPeriod(setup.partner.id)).id);
    expect(first.netPayableAmount.toFixed(4)).toBe('28350.0000');
    expect((await prisma.referralWithholding.findFirstOrThrow()).remainingAmount.toFixed(4)).toBe('150.0000');

    // The referrer's own later purchases repay the 150 (green 100 + 50).
    const shop = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const shopStaff = await s.staff(shop.id);
    for (const gross of ['10000', '5000']) {
      const p = await intents.create({ partnerId: shop.id, grossAmount: gross }, referrer.id);
      await intents.confirm(p.id, shopStaff.id);
    }
    expect((await prisma.referralWithholding.findFirstOrThrow()).status).toBe('SETTLED');
    const second = await draftCurrentPeriod(setup.partner.id);
    expect(await kindsOf(second.id)).toEqual(['referral.withholding_recovered:CREDIT:100', 'referral.withholding_recovered:CREDIT:50']);
    expect(second.netPayableAmount.toFixed(4)).toBe('150.0000');
    await assertExplained(setup.partner.id);
  });

  it('7: a Q9 desk shortfall is the partner’s debt to TuTak in settlement', async () => {
    const setup = await partnerSetup({ rateBps: 2000 });
    const customer = await s.customer();
    // 50000 paid in cash; the customer spends 1700 of the 2000 green it earned.
    const order = await complete(setup, customer.user.id, {}, '50000');
    const elsewhere = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const elsewhereStaff = await s.staff(elsewhere.id);
    const spend = await intents.create({ partnerId: elsewhere.id, grossAmount: '10000', bonusAmountRequested: '1700' }, customer.user.id);
    await intents.confirm(spend.id, elsewhereStaff.id);
    const pending = await returns.createReturn({ orderId: order.id, reason: 'returned', actorId: setup.staff.id, actorType: 'PARTNER', idempotencyKey: 's7' });
    await returns.settleShortfall(pending.id, setup.staff.id, '0');

    const unsettled = await assertExplained(setup.partner.id);
    // Commission 10000 charged and reversed; the 1700 the partner kept from the cash is TuTak's.
    expect(unsettled.entries.map((e) => `${e.kind}:${e.direction}:${e.amount.toFixed(0)}`).sort()).toEqual([
      'partner.contribution:DEBIT:10000',
      'partner.contribution_refund:CREDIT:10000',
      'partner_order.shortfall_settled_at_desk:DEBIT:1700',
    ]);
    expect(unsettled.net.toFixed(4)).toBe('-1700.0000');
    await expect(draftCurrentPeriod(setup.partner.id)).rejects.toThrow(/Nothing to pay/);
  });

  // ── 8: disputes ────────────────────────────────────────────────────────────

  it('8: a disputed amount is never paid — frozen, excluded, and settleable only once released', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('50000');
    const order = await complete(setup, customer.user.id, { money: '30000' }, '30000');
    const dispute = await disputes.open({ orderId: order.id, type: 'ORDER', reason: 'damaged', actorId: customer.user.id, actorType: 'CUSTOMER' });
    expect(dispute.frozenAmount.toFixed(4)).toBe('28500.0000');
    const frozen = await assertExplained(setup.partner.id);
    expect(frozen.net.toFixed(4)).toBe('0.0000');
    await expect(draftCurrentPeriod(setup.partner.id)).rejects.toThrow(/Nothing to pay/);

    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_PARTNER', note: 'no damage' });
    const draft = await draftCurrentPeriod(setup.partner.id);
    expect(draft.netPayableAmount.toFixed(4)).toBe('28500.0000');
    expect(await kindsOf(draft.id)).toEqual([
      'order_dispute.hold:DEBIT:28500',
      'order_dispute.release:CREDIT:28500',
      'partner.contribution:DEBIT:1500',
      'partner_order.completion:CREDIT:30000',
    ]);
    await pay(draft.id);
    await assertExplained(setup.partner.id);
  });

  it('8b: open dispute × settlement — whichever wins, the disputed amount is never paid', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('50000');
    const order = await complete(setup, customer.user.id, { money: '30000' }, '30000');
    const [opened, drafted] = await Promise.allSettled([
      disputes.open({ orderId: order.id, type: 'ORDER', reason: 'x', actorId: customer.user.id, actorType: 'CUSTOMER' }),
      draftCurrentPeriod(setup.partner.id),
    ]);
    expect(opened.status).toBe('fulfilled');
    if (drafted.status === 'fulfilled') {
      // The draft claimed the credit first; the dispute froze it after. Approving would pay it: refused.
      await engine.markReady(drafted.value.id, { actorId: maker });
      await expect(engine.approve(drafted.value.id, checker)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'OPEN_DISPUTE_NOT_IN_SETTLEMENT' }),
      });
      await engine.cancel(drafted.value.id, { actorId: maker, reason: 'redraft after dispute' });
    } else {
      expect(String(drafted.reason)).toMatch(/Nothing to pay/);
    }
    // Redrafted: the credit nets against its hold — nothing payable while the dispute is open.
    await expect(draftCurrentPeriod(setup.partner.id)).rejects.toThrow(/Nothing to pay/);
    expect(await prisma.partnerSettlement.count({ where: { status: 'PAID' } })).toBe(0);
    await assertExplained(setup.partner.id);
  });

  // ── 8c-8h: a dispute after approval (docs/PARTNER_COMMERCE.md §14) ──────────

  /** One 30000 money order, drafted, made ready and approved: 28500 committed. */
  async function approvedSettlement() {
    const setup = await partnerSetup();
    const customer = await s.customer('50000');
    const order = await complete(setup, customer.user.id, { money: '30000' }, '30000');
    const draft = await draftCurrentPeriod(setup.partner.id);
    await engine.markReady(draft.id, { actorId: maker, documentNumber: 'ФАКТУРА' });
    const approved = await engine.approve(draft.id, checker);
    expect(approved.status).toBe('APPROVED');
    expect(approved.netPayableAmount.toFixed(4)).toBe('28500.0000');
    return { setup, customer, order, settlement: approved };
  }

  const refused = (error: string) => expect.objectContaining({ response: expect.objectContaining({ error }) });
  const paidPostings = (settlementId: string) =>
    prisma.ledgerTransaction.count({ where: { kind: 'partner.settlement.paid', sourceType: 'PartnerSettlement', sourceId: settlementId } });
  const openOrderDispute = (orderId: string, customerId: string) =>
    disputes.open({ orderId, type: 'ORDER', reason: 'damaged', actorId: customerId, actorType: 'CUSTOMER' });

  it('8c: a dispute opened after approval blocks PAID — nothing posted, status unchanged', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    const dispute = await openOrderDispute(order.id, customer.user.id);
    // The credit was committed, so nothing was frozen: the settlement still claims all of it.
    expect(dispute.openedAfterSettlement).toBe(true);
    expect(dispute.holdLedgerTransactionId).toBeNull();

    await expect(engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'BANK-8C' })).rejects.toEqual(
      refused('OPEN_DISPUTE_NOT_IN_SETTLEMENT'),
    );
    // Nor may a transfer be started for it.
    await expect(engine.markPaymentPending(settlement.id, checker)).rejects.toEqual(refused('OPEN_DISPUTE_NOT_IN_SETTLEMENT'));
    expect(await paidPostings(settlement.id)).toBe(0);
    const after = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(after.status).toBe('APPROVED');
    expect(after.bankTransferReference).toBeNull();
    expect(await prisma.partnerSettlementTransferAttempt.count({ where: { settlementId: settlement.id } })).toBe(0);
    await assertExplained(setup.partner.id);
  });

  it('8d: the partner wins — the approved settlement is paid as it is, no redraft', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    const dispute = await openOrderDispute(order.id, customer.user.id);
    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_PARTNER', note: 'goods were fine' });

    const paid = await engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'BANK-8D' });
    expect(paid.status).toBe('PAID');
    expect(paid.netPayableAmount.toFixed(4)).toBe('28500.0000');
    expect(await paidPostings(settlement.id)).toBe(1);
    expect((await owedToPartner(setup.partner.id)).toFixed(4)).toBe('0.0000');
    await assertExplained(setup.partner.id);
  });

  it.each([
    // [outcome, refund, next net = 28500 − refund + 5% commission on the refund]
    ['RESOLVED_CUSTOMER', '12000', '17100.0000'],
    ['RESOLVED_SPLIT', '6000', '22800.0000'],
  ] as const)(
    '8e: %s before any transfer — the stale 28500 is not paid; revoke releases the claims and the closed-period draft nets the refund',
    async (outcome, refund, nextNet) => {
      const { setup, customer, order, settlement } = await approvedSettlement();
      const dispute = await openOrderDispute(order.id, customer.user.id);
      await disputes.resolve(dispute.id, setup.admin.id, { outcome, customerRefundAmount: refund, note: 'damaged on arrival' });

      await expect(engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'BANK-8E' })).rejects.toEqual(
        refused('DISPUTE_REFUND_NOT_IN_SETTLEMENT'),
      );
      await expect(engine.markPaymentPending(settlement.id, checker)).rejects.toEqual(refused('DISPUTE_REFUND_NOT_IN_SETTLEMENT'));
      expect(await paidPostings(settlement.id)).toBe(0);
      // An approved settlement is not cancellable; its approval is revocable.
      await expect(engine.cancel(settlement.id, { actorId: maker, reason: 'x' })).rejects.toThrow(/draft or ready/);

      const claimedBefore = (await prisma.partnerSettlementEntry.findMany({ where: { settlementId: settlement.id } })).map((e) => e.ledgerPostingId);
      const revoked = await engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute decided for the customer' });
      expect(revoked.status).toBe('CANCELLED');
      expect(revoked.approvedByUserId).toBe(checker); // the approval stays as history
      expect(revoked.cancelledReason).toMatch(/approval revoked/);
      expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } })).toBe(0);
      // Revoke drafts nothing: the postings are simply unsettled again.
      expect(await prisma.partnerSettlement.count({ where: { partnerId: setup.partner.id, status: { in: ['DRAFT', 'READY'] } } })).toBe(0);
      const unsettled = await assertExplained(setup.partner.id);
      expect(unsettled.entries.map((e) => e.ledgerPostingId)).toEqual(expect.arrayContaining(claimedBefore));
      expect(unsettled.net.toFixed(4)).toBe(nextNet);

      // The next settlement of the cadence claims the released credit and the refund together, once.
      const next = await draftCurrentPeriod(setup.partner.id);
      expect(next.netPayableAmount.toFixed(4)).toBe(nextNet);
      const nextClaims = (await prisma.partnerSettlementEntry.findMany({ where: { settlementId: next.id } })).map((e) => e.ledgerPostingId);
      expect(nextClaims).toEqual(expect.arrayContaining(claimedBefore));
      expect(await kindsOf(next.id)).toEqual(
        expect.arrayContaining([
          'partner_order.completion:CREDIT:30000',
          'partner.contribution:DEBIT:1500',
          `partner_order.return_money:DEBIT:${Number(refund)}`,
          `partner.contribution_refund:CREDIT:${Number(refund) / 20}`,
        ]),
      );
      await assertExplained(setup.partner.id);

      const paid = await pay(next.id);
      expect(paid.status).toBe('PAID');
      expect(paid.netPayableAmount.toFixed(4)).toBe(nextNet);
      expect((await owedToPartner(setup.partner.id)).toFixed(4)).toBe('0.0000');
      await assertExplained(setup.partner.id);
    },
  );

  it('8f: PAYMENT_PENDING and the customer wins — no revoke, no cancel; the transfer finishes and the refund is next period\'s debt', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    await engine.markPaymentPending(settlement.id, checker);
    const dispute = await openOrderDispute(order.id, customer.user.id);
    // Still OPEN: not recorded as paid, whatever the bank does.
    await expect(engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'BANK-8F' })).rejects.toEqual(
      refused('OPEN_DISPUTE_NOT_IN_SETTLEMENT'),
    );
    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '12000', note: 'damaged' });

    await expect(engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute' })).rejects.toEqual(refused('TRANSFER_MAY_HAVE_STARTED'));
    await expect(engine.cancel(settlement.id, { actorId: maker, reason: 'dispute' })).rejects.toThrow(/draft or ready/);
    expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } })).toBe(4 - 2); // completion + contribution, still claimed

    // The bank confirms the transfer went: the existing lifecycle records it.
    const paid = await engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'BANK-8F' });
    expect(paid.status).toBe('PAID');
    expect(paid.netPayableAmount.toFixed(4)).toBe('28500.0000');
    // The refund (12000 − 600 commission back) is the partner's debt, unclaimed.
    const debt = await assertExplained(setup.partner.id);
    expect(debt.net.toFixed(4)).toBe('-11400.0000');
    await expect(draftCurrentPeriod(setup.partner.id)).rejects.toThrow(/Nothing to pay/);

    // Netted by the next settlement: 40000 − 2000 − 11400.
    const other = await s.customer('50000');
    await complete(setup, other.user.id, { money: '40000' }, '40000');
    const next = await draftCurrentPeriod(setup.partner.id);
    expect(next.netPayableAmount.toFixed(4)).toBe('26600.0000');
    await assertExplained(setup.partner.id);
  });

  it('8g: REQUIRES_RECONCILIATION — claims stay; no new draft can take the same postings', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    await engine.markPaymentPending(settlement.id, checker);
    await engine.markRequiresReconciliation(settlement.id, { actorId: checker, reason: 'bank timeout' });
    const dispute = await openOrderDispute(order.id, customer.user.id);
    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '12000', note: 'damaged' });

    await expect(engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute' })).rejects.toEqual(refused('TRANSFER_MAY_HAVE_STARTED'));
    const claimed = (await prisma.partnerSettlementEntry.findMany({ where: { settlementId: settlement.id } })).map((e) => e.ledgerPostingId);
    expect(claimed).toHaveLength(2);
    // Only the refund is unclaimed — a negative net, so nothing to draft.
    const unsettled = await engine.unsettled(setup.partner.id);
    expect(unsettled.entries.map((e) => e.ledgerPostingId).filter((id) => claimed.includes(id))).toEqual([]);
    await expect(draftCurrentPeriod(setup.partner.id)).rejects.toThrow(/Nothing to pay/);

    // Even with new earnings, a new draft claims only new postings.
    const other = await s.customer('50000');
    await complete(setup, other.user.id, { money: '40000' }, '40000');
    const next = await draftCurrentPeriod(setup.partner.id);
    const nextClaims = (await prisma.partnerSettlementEntry.findMany({ where: { settlementId: next.id } })).map((e) => e.ledgerPostingId);
    expect(nextClaims.filter((id) => claimed.includes(id))).toEqual([]);
    expect(next.netPayableAmount.toFixed(4)).toBe('26600.0000');
    await expect(
      prisma.partnerSettlementEntry.create({
        data: { settlementId: next.id, ledgerPostingId: claimed[0]!, partnerId: setup.partner.id, amount: 1, direction: 'CREDIT', kind: 'x', sourceType: 'x', sourceId: 'x', occurredAt: new Date() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' }); // one posting, one claim — the database says so

    // Reconciliation, not a redraft, closes the ambiguous one.
    await engine.proposeReconciliationOutcome(settlement.id, { actorId: maker, outcome: 'MONEY_MOVED', evidence: 'statement line 7', bankTransferReference: 'BANK-8G' });
    const paid = await engine.confirmReconciliationOutcome(settlement.id, { actorId: checker });
    expect(paid.status).toBe('PAID');
    expect(paid.netPayableAmount.toFixed(4)).toBe('28500.0000');
    await assertExplained(setup.partner.id);
  });

  it('8h: decided for the customer before the transfer — what the partner is actually paid is the current net, not the stale figure', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    const dispute = await openOrderDispute(order.id, customer.user.id);
    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '12000', note: 'damaged' });
    // The approved 28500 cannot be recorded as paid...
    await expect(engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'BANK-8H' })).rejects.toEqual(
      refused('DISPUTE_REFUND_NOT_IN_SETTLEMENT'),
    );
    // ...so the only way to pay is to revoke and let the cadence's next draft claim what is owed now.
    await engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute decided for the customer' });
    await pay((await draftCurrentPeriod(setup.partner.id)).id);

    const payouts = await prisma.partnerSettlement.findMany({ where: { partnerId: setup.partner.id, status: 'PAID' } });
    const totalPaid = payouts.reduce((sum, p) => sum.plus(p.netPayableAmount), new Decimal(0));
    // 30000 electronic − 1500 commission − 12000 refunded + 600 commission returned.
    expect(totalPaid.toFixed(4)).toBe('17100.0000');
    expect(totalPaid.toFixed(4)).not.toBe(settlement.netPayableAmount.toFixed(4));
    // The bank posting is the same figure, and nothing is left owed either way.
    const bankOut = await prisma.ledgerPosting.aggregate({
      where: { transaction: { kind: 'partner.settlement.paid', sourceId: { in: payouts.map((p) => p.id) } }, direction: 'CREDIT' },
      _sum: { amount: true },
    });
    expect(bankOut._sum.amount!.toFixed(4)).toBe('17100.0000');
    expect((await owedToPartner(setup.partner.id)).toFixed(4)).toBe('0.0000');
    // The customer has the 12000 back.
    expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-32000.0000');
    await assertExplained(setup.partner.id);
  });

  // ── 8i-8k: FAILED — revocable only when the attempt record proves no money moved ──

  it('8i: FAILED with the bank\'s unambiguous "no" — provably unpaid: the stale figure is not retried and the approval can be revoked', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    await engine.markPaymentPending(settlement.id, checker);
    const failed = await engine.markFailed(settlement.id, { actorId: checker, reason: 'IBAN closed', bankTransferReference: 'BOUNCE-8I' });
    expect(failed.status).toBe('FAILED');
    const dispute = await openOrderDispute(order.id, customer.user.id);
    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '12000', note: 'damaged' });

    // The proof: one attempt, resolved, failed — and nothing else.
    const attempts = await prisma.partnerSettlementTransferAttempt.findMany({ where: { settlementId: settlement.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ succeeded: false, bankTransferReference: 'BOUNCE-8I' });
    expect(attempts[0]!.resolvedAt).not.toBeNull();
    // So a retry of the stale 28500 is refused, in both forms.
    await expect(engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'RETRY-8I' })).rejects.toEqual(
      refused('DISPUTE_REFUND_NOT_IN_SETTLEMENT'),
    );
    await expect(engine.markPaymentPending(settlement.id, checker)).rejects.toEqual(refused('DISPUTE_REFUND_NOT_IN_SETTLEMENT'));
    expect(await paidPostings(settlement.id)).toBe(0);
    await expect(engine.cancel(settlement.id, { actorId: maker, reason: 'x' })).rejects.toThrow(/draft or ready/);

    const revoked = await engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute decided for the customer' });
    expect(revoked.status).toBe('CANCELLED');
    expect(revoked.failedReason).toBe('IBAN closed'); // history kept
    expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } })).toBe(0);
    expect(await prisma.partnerSettlement.count({ where: { partnerId: setup.partner.id, status: { in: ['DRAFT', 'READY'] } } })).toBe(0);
    const next = await draftCurrentPeriod(setup.partner.id);
    expect(next.netPayableAmount.toFixed(4)).toBe('17100.0000');
    await pay(next.id);
    expect((await owedToPartner(setup.partner.id)).toFixed(4)).toBe('0.0000');
    await assertExplained(setup.partner.id);
  });

  it('8j: FAILED by a two-person MONEY_DID_NOT_MOVE — the ambiguous attempt is resolved in place, so the settlement is provably unpaid and revocable', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    await engine.markPaymentPending(settlement.id, checker);
    await engine.markRequiresReconciliation(settlement.id, { actorId: checker, reason: 'bank timeout', bankTransferReference: 'MAYBE-8J' });
    const dispute = await openOrderDispute(order.id, customer.user.id);
    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '12000', note: 'damaged' });
    // While the bank's answer is unknown: neither payable nor revocable.
    await expect(engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute' })).rejects.toEqual(refused('TRANSFER_MAY_HAVE_STARTED'));
    await expect(engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'GUESS' })).rejects.toThrow(/needs reconciliation/);

    await engine.proposeReconciliationOutcome(settlement.id, { actorId: maker, outcome: 'MONEY_DID_NOT_MOVE', evidence: 'no debit on the statement' });
    const failed = await engine.confirmReconciliationOutcome(settlement.id, { actorId: checker });
    expect(failed.status).toBe('FAILED');
    // The same attempt turned out not to have worked — not a new row beside an unresolved one.
    const attempts = await prisma.partnerSettlementTransferAttempt.findMany({ where: { settlementId: settlement.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ succeeded: false, bankTransferReference: 'MAYBE-8J', failureReason: 'no debit on the statement' });
    expect(attempts[0]!.resolvedAt).not.toBeNull();

    await expect(engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'RETRY-8J' })).rejects.toEqual(
      refused('DISPUTE_REFUND_NOT_IN_SETTLEMENT'),
    );
    const revoked = await engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute decided for the customer' });
    expect(revoked.status).toBe('CANCELLED');
    expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } })).toBe(0);
    const next = await draftCurrentPeriod(setup.partner.id);
    expect(next.netPayableAmount.toFixed(4)).toBe('17100.0000');
    await pay(next.id);
    await assertExplained(setup.partner.id);
  });

  it('8k: FAILED after a retracted MONEY_MOVED reading — not provable: revoke refused, the retry pays the approved figure and the refund is debt', async () => {
    const { setup, customer, order, settlement } = await approvedSettlement();
    await engine.markPaymentPending(settlement.id, checker);
    await engine.markRequiresReconciliation(settlement.id, { actorId: checker, reason: 'bank timeout' });
    await engine.proposeReconciliationOutcome(settlement.id, { actorId: maker, outcome: 'MONEY_MOVED', evidence: 'statement line 3', bankTransferReference: 'SEEN-8K' });
    await engine.proposeReconciliationOutcome(settlement.id, { actorId: maker, outcome: 'MONEY_DID_NOT_MOVE', evidence: 'line 3 was another partner' });
    const failed = await engine.confirmReconciliationOutcome(settlement.id, { actorId: checker });
    expect(failed.status).toBe('FAILED');
    expect(failed.bankTransferReference).toBe('SEEN-8K'); // the retracted reading left its reference behind
    const dispute = await openOrderDispute(order.id, customer.user.id);
    await disputes.resolve(dispute.id, setup.admin.id, { outcome: 'RESOLVED_CUSTOMER', customerRefundAmount: '12000', note: 'damaged' });

    await expect(engine.revokeApproval(settlement.id, { actorId: maker, reason: 'dispute' })).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'TRANSFER_MAY_HAVE_STARTED', message: expect.stringContaining('bank transfer reference') }),
    });
    expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } })).toBe(2);
    // Not provably unpaid, so the refund does not block: the retry pays the approved figure and the refund is the partner's debt.
    const paid = await engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: 'RETRY-8K' });
    expect(paid.status).toBe('PAID');
    expect(await paidPostings(settlement.id)).toBe(1);
    const debt = await assertExplained(setup.partner.id);
    expect(debt.net.toFixed(4)).toBe('-11400.0000');
  });

  // ── 8r: resolve(dispute) × markPaid on real PostgreSQL ────────────────────

  describe('8r: resolve(dispute) × markPaid — no interleaving pays the stale pre-refund figure', () => {
    const orderings = [
      ['pay', 0],
      ['resolve', 0],
      ['pay', 15],
      ['resolve', 15],
    ] as const;

    async function race(outcome: 'RESOLVED_CUSTOMER' | 'RESOLVED_SPLIT' | 'RESOLVED_PARTNER', first: 'pay' | 'resolve', delayMs: number) {
      const { setup, customer, order, settlement } = await approvedSettlement();
      const dispute = await openOrderDispute(order.id, customer.user.id);
      const refund = outcome === 'RESOLVED_PARTNER' ? {} : { customerRefundAmount: '12000' };
      const resolve = () => disputes.resolve(dispute.id, setup.admin.id, { outcome, ...refund, note: 'race' });
      const payNow = () => engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: `RACE-${settlement.id.slice(0, 8)}` });
      const later = <T>(fn: () => Promise<T>) =>
        new Promise<T>((res, rej) => {
          setTimeout(() => {
            void fn().then(res, rej);
          }, delayMs);
        });
      const [a, b] = first === 'pay' ? await Promise.allSettled([payNow(), later(resolve)]) : await Promise.allSettled([resolve(), later(payNow)]);
      const [payResult, resolveResult] = first === 'pay' ? [a, b] : [b, a];
      expect(resolveResult.status).toBe('fulfilled');
      return { setup, settlement, payResult };
    }
    const errorOf = (r: PromiseSettledResult<unknown>) =>
      r.status === 'rejected' ? ((r.reason as { response?: { error?: string } }).response?.error ?? String(r.reason)) : null;

    it.each(['RESOLVED_CUSTOMER', 'RESOLVED_SPLIT'] as const)('%s: markPaid is refused in every ordering; nothing is posted', async (outcome) => {
      for (const [first, delayMs] of orderings) {
        const { setup, settlement, payResult } = await race(outcome, first, delayMs);
        expect(payResult.status).toBe('rejected');
        expect(['OPEN_DISPUTE_NOT_IN_SETTLEMENT', 'DISPUTE_REFUND_NOT_IN_SETTLEMENT']).toContain(errorOf(payResult));
        const after = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
        expect(after.status).toBe('APPROVED');
        expect(await paidPostings(settlement.id)).toBe(0);
        expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } })).toBe(2);
        await assertExplained(setup.partner.id);
      }
    });

    it('RESOLVED_PARTNER: markPaid passes once the decision is final, and pays exactly once', async () => {
      for (const [first, delayMs] of orderings) {
        const { setup, settlement, payResult } = await race('RESOLVED_PARTNER', first, delayMs);
        if (payResult.status === 'rejected') {
          // It saw the dispute still open; the decision is in now.
          expect(errorOf(payResult)).toBe('OPEN_DISPUTE_NOT_IN_SETTLEMENT');
          await engine.markPaid(settlement.id, { actorId: checker, bankTransferReference: `RACE2-${settlement.id.slice(0, 8)}` });
        }
        const after = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
        expect(after.status).toBe('PAID');
        expect(after.netPayableAmount.toFixed(4)).toBe('28500.0000');
        expect(await paidPostings(settlement.id)).toBe(1);
        expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: settlement.id } })).toBe(2);
        expect((await owedToPartner(setup.partner.id)).toFixed(4)).toBe('0.0000');
        await assertExplained(setup.partner.id);
      }
    });
  });

  // ── 9: cancellation actual cost ────────────────────────────────────────────

  it('9: an approved actual cancellation cost is settled from the money part only', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('30000');
    const created = await orders.create(setup.partner.id, setup.integrationId, orderDto(`C-${Math.random()}`, '20000', { cancellationTerms: 'Доставка не возвращается' }));
    await orders.submit(created.id, customer.user.id, { tutakMoneyAmount: '20000', idempotencyKey: `c-${created.id}` });
    await orders.confirmStock(created.id, setup.staff.id);
    await cancellations.request(created.id, customer.user.id, 'changed my mind');
    await cancellations.claimCost(created.id, setup.staff.id, { amount: '3000', reason: 'Courier already paid', evidence: 'Invoice 12' });
    const req = await prisma.partnerOrderCancellation.findFirstOrThrow({ where: { orderId: created.id } });
    await cancellations.decide(req.id, setup.admin.id, { decision: 'APPROVE', note: 'invoice checked' });
    expect(await s.balance(A.CUSTOMER_PREPAID_BALANCE, { userId: customer.user.id })).toBe('-27000.0000');

    const draft = await draftCurrentPeriod(setup.partner.id);
    // Only the approved cost; no commission, no distribution on a cancellation.
    expect(await kindsOf(draft.id)).toEqual(['partner_order.cancellation_cost:CREDIT:3000']);
    await pay(draft.id);
    await assertExplained(setup.partner.id);
  });

  // ── 10: double claim ───────────────────────────────────────────────────────

  it('10: two settlement workers never claim one posting twice', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('90000');
    await complete(setup, customer.user.id, { money: '30000' }, '30000');
    await complete(setup, customer.user.id, { money: '40000' }, '40000');
    const results = await Promise.allSettled([draftCurrentPeriod(setup.partner.id), draftCurrentPeriod(setup.partner.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const entries = await prisma.partnerSettlementEntry.findMany();
    expect(new Set(entries.map((e) => e.ledgerPostingId)).size).toBe(entries.length);
    expect(entries).toHaveLength(4);
    await assertExplained(setup.partner.id);
  });

  // ── 11-14: cadence ─────────────────────────────────────────────────────────

  describe('11-14: one cadence — Partner.settlementPeriodicity (+ anchor)', () => {
    // 2026-09-26 is a Saturday; Yerevan is UTC+4.
    const at = new Date('2026-09-26T10:00:00Z');

    it('11: DAILY — each Yerevan day; the anchor is ignored', async () => {
      expect(periodContaining('DAILY', 5, at)).toEqual({ start: new Date('2026-09-25T20:00:00Z'), end: new Date('2026-09-26T20:00:00Z') });
      expect(lastClosedPeriod('DAILY', 1, at).start).toEqual(new Date('2026-09-24T20:00:00Z'));
      await cadenceDraft(SettlementPeriodicity.DAILY, 1);
    });

    it('12: WEEKLY — seven days from the anchor weekday', async () => {
      // Anchor 1 = Monday: Mon 21 Sep … Mon 28 Sep.
      expect(periodContaining('WEEKLY', 1, at)).toEqual({ start: new Date('2026-09-20T20:00:00Z'), end: new Date('2026-09-27T20:00:00Z') });
      // Anchor 6 = Saturday: the period starts today.
      expect(periodContaining('WEEKLY', 6, at).start).toEqual(new Date('2026-09-25T20:00:00Z'));
      await cadenceDraft(SettlementPeriodicity.WEEKLY, 3);
    });

    it('13: BIWEEKLY — fourteen-day blocks from the anchor weekday', async () => {
      const period = periodContaining('BIWEEKLY', 1, at);
      expect(period.end.getTime() - period.start.getTime()).toBe(14 * 86_400_000);
      expect([new Date('2026-09-13T20:00:00Z').getTime(), new Date('2026-09-20T20:00:00Z').getTime()]).toContain(period.start.getTime());
      expect(lastClosedPeriod('BIWEEKLY', 1, at).end).toEqual(period.start);
      await cadenceDraft(SettlementPeriodicity.BIWEEKLY, 2);
    });

    it('14: MONTHLY — from the anchor day to the same day next month', async () => {
      expect(periodContaining('MONTHLY', 1, at)).toEqual({ start: new Date('2026-08-31T20:00:00Z'), end: new Date('2026-09-30T20:00:00Z') });
      expect(periodContaining('MONTHLY', 28, at)).toEqual({ start: new Date('2026-08-27T20:00:00Z'), end: new Date('2026-09-27T20:00:00Z') });
      await expect(engine.setPeriodicity({ partnerId: (await createPartner(prisma)).id, periodicity: 'MONTHLY', anchorDay: 29, actorId: maker })).rejects.toThrow(/1-28/);
      await cadenceDraft(SettlementPeriodicity.MONTHLY, 15);
    });

    /**
     * The cadence decides which postings a draft may claim: the period that
     * contains today claims today's order; the one that closed before it
     * cannot (nothing to pay), because its end is before the posting.
     */
    async function cadenceDraft(periodicity: SettlementPeriodicity, anchorDay: number) {
      const setup = await partnerSetup({ periodicity });
      await engine.setPeriodicity({ partnerId: setup.partner.id, periodicity, anchorDay, actorId: setup.admin.id });
      const customer = await s.customer('50000');
      await complete(setup, customer.user.id, { money: '30000' }, '30000');
      const current = periodContaining(periodicity, anchorDay, new Date());
      await expect(engine.createDraftForClosedPeriod({ partnerId: setup.partner.id, actorId: maker, now: current.start })).rejects.toThrow(/Nothing to pay/);
      const draft = await engine.createDraftForClosedPeriod({ partnerId: setup.partner.id, actorId: maker, now: new Date(current.end.getTime() + 1) });
      expect(draft.periodStart).toEqual(current.start);
      expect(draft.periodEnd).toEqual(current.end);
      expect(draft.netPayableAmount.toFixed(4)).toBe('28500.0000');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PARTNER_SETTLEMENT_PERIOD_CHANGED', entityId: setup.partner.id }, orderBy: { createdAt: 'desc' } });
      expect((audit.metadata as { to: { periodicity: string } }).to.periodicity).toBe(periodicity);
    }
  });

  // ── 15: fail-safe ──────────────────────────────────────────────────────────

  it('15: an unknown new PARTNER_PAYABLE kind is never paid and is a reconciliation finding', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('50000');
    await complete(setup, customer.user.id, { money: '30000' }, '30000');
    const [payable, revenue] = await Promise.all([
      ledger.accountFor({ type: A.PARTNER_PAYABLE, partnerId: setup.partner.id }),
      ledger.accountFor({ type: A.PLATFORM_REVENUE }),
    ]);
    await ledger.post({
      kind: 'partner_order.some_future_kind',
      sourceType: 'PartnerOrder',
      sourceId: 'future',
      postings: [
        { accountId: revenue.id, direction: PostingDirection.DEBIT, amount: new Decimal(999) },
        { accountId: payable.id, direction: PostingDirection.CREDIT, amount: new Decimal(999) },
      ],
    });
    const unsettled = await engine.unsettled(setup.partner.id);
    expect(unsettled.unrecognised).toEqual(['partner_order.some_future_kind']);
    expect(unsettled.net.toFixed(4)).toBe('28500.0000');
    const draft = await draftCurrentPeriod(setup.partner.id);
    expect(draft.netPayableAmount.toFixed(4)).toBe('28500.0000');
    expect((await kindsOf(draft.id)).some((k) => k.startsWith('partner_order.some_future_kind'))).toBe(false);
    const statement = await statements.periodStatementAt(setup.partner.id, new Date());
    expect(statement.unrecognisedKinds).toEqual(['partner_order.some_future_kind']);
    expect(statement.totals.notSettleable).toBe('999.0000');
  });

  // ── 16: existing flows + the statement report ──────────────────────────────

  it('16: a QR purchase with TuTak money settles through the same engine; the statement explains every line', async () => {
    const setup = await partnerSetup();
    const customer = await s.customer('50000', '2000');
    const intent = await intents.create({ partnerId: setup.partner.id, grossAmount: '30000', bonusAmountRequested: '1000', tutakMoneyAmount: '5000' }, customer.user.id);
    await intents.confirm(intent.id, setup.staff.id);
    const draft = await draftCurrentPeriod(setup.partner.id);
    // Money 5000 + discount compensation 1000 − commission 1500 = 4500.
    expect(await kindsOf(draft.id)).toEqual([
      'partner.bonus_redemption_compensation:CREDIT:1000',
      'partner.contribution:DEBIT:1500',
      'purchase_intent.money_release:CREDIT:5000',
    ]);
    expect(draft.netPayableAmount.toFixed(4)).toBe('4500.0000');
    await pay(draft.id);

    const statement = await statements.periodStatementAt(setup.partner.id, new Date());
    expect(statement.periodicity).toBe('DAILY');
    const payable = statement.lines.filter((l) => l.account === 'PARTNER_PAYABLE');
    expect(payable.every((l) => l.classification !== 'NOT_SETTLEABLE')).toBe(true);
    expect(payable.filter((l) => l.classification === 'SETTLEABLE').every((l) => l.settlementId === draft.id && l.settlementStatus === 'PAID')).toBe(true);
    expect(payable.filter((l) => l.classification === 'TRANSFER').map((l) => l.kind)).toEqual(['partner.settlement.paid']);
    expect(statement.totals.claimedBySettlements).toBe('4500.0000');
    expect(statement.closingOwedToPartner).toBe((await owedToPartner(setup.partner.id)).toFixed(4));
    expect(statement.closingOwedToPartner).toBe('0.0000');
    const summary = await statements.balanceSummary(setup.partner.id);
    expect(summary.unsettledNet).toBe('0.0000');
    expect(summary.settlementPeriodicity).toBe('DAILY');
    await assertExplained(setup.partner.id);
  });
});
