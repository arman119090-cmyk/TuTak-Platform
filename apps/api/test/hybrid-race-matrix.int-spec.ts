import {
  BonusEntryType,
  LedgerAccountType,
  PartnerSettlementStatus,
  PrismaClient,
  PurchaseIntentStatus,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'node:crypto';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { PartnerCollectionService } from '../src/modules/payouts/partner-collection.service';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import {
  createCustomer,
  createPartner,
  createStaffUser,
  fundPrepaidBalance,
} from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The brief's failure / race matrix (§31), the server-side rows, on a real
 * PostgreSQL. Every scenario asserts the same seven properties by
 * inspecting the records afterwards: no double spend of the balance, no
 * double credit, no double bonus, no double referral, no double partner
 * payable, no double refund, no double payout. `invariants()` is that list
 * in code, and every test ends with it.
 *
 * Rows covered elsewhere and not repeated: 4 (hybrid-funding: two 45 000
 * holds), 12–13 (partner-checkout: duplicate POS event / external
 * reference), 14–17 (customer-balance: repeated, late, duplicate and
 * concurrent top-up callbacks), 22 (hybrid-refund: refund after PAID).
 * Rows 25–26 are client behaviour (a stale balance on screen, cached
 * financial data across logout) and are proved by the mobile suites, not
 * here.
 */
describe('Hybrid race matrix on PostgreSQL (§31)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let refunds: PurchaseIntentRefundService;
  let balance: CustomerBalanceService;
  let ledger: LedgerService;
  let engine: BonusEngineService;
  let settlements: PartnerSettlementService;
  let collections: PartnerCollectionService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    refunds = harness.app.get(PurchaseIntentRefundService);
    balance = harness.app.get(CustomerBalanceService);
    ledger = harness.app.get(LedgerService);
    engine = harness.app.get(BonusEngineService);
    settlements = harness.app.get(PartnerSettlementService);
    collections = harness.app.get(PartnerCollectionService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(prisma);
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  const customer = async (bonus: string, money: string) => {
    const { user, wallet } = await createCustomer(prisma);
    if (new Decimal(bonus).greaterThan(0)) {
      await engine.accrue({ walletId: wallet.id, type: BonusEntryType.ACCRUAL_PURCHASE, amount: bonus, pendingHours: 0 });
    }
    if (new Decimal(money).greaterThan(0)) await fundPrepaidBalance(ledger, user.id, money);
    return { user, wallet };
  };

  const partnerWithStaff = async () => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
    const staff = await createStaffUser(prisma);
    await prisma.userRole.create({ data: { userId: staff.id, roleId: role.id, partnerId: partner.id } });
    return { partner, staff };
  };

  /** CASE D at 5%: 5 000 bonus + 20 000 balance + 25 000 at the till on 50 000. */
  const openCaseD = async (partnerId: string, userId: string) =>
    purchaseIntents.create(
      { partnerId, grossAmount: '50000', bonusAmountRequested: '5000', prepaidAmountApplied: '20000' },
      userId,
    );

  const countKind = (kind: string, sourceId?: string) =>
    prisma.ledgerTransaction.count({ where: { kind, ...(sourceId ? { sourceId } : {}) } });

  /**
   * The seven properties, checked from the records rather than from the
   * services' return values. Called at the end of every scenario.
   */
  const invariants = async () => {
    // Every materialised balance equals the replay of its own postings —
    // no double spend, no double credit can hide from this.
    const accounts = await prisma.ledgerAccount.findMany({ select: { id: true, balance: true, type: true } });
    for (const account of accounts) {
      expect((await ledger.replayBalance(account.id)).toFixed(4)).toBe(account.balance.toFixed(4));
    }
    // No customer's available balance below zero.
    for (const account of accounts.filter((a) => a.type === LedgerAccountType.CUSTOMER_PREPAID_BALANCE)) {
      expect(account.balance.lessThanOrEqualTo(0)).toBe(true);
    }
    // No purchase settled twice: at most one contribution, one compensation,
    // one funding posting per purchase.
    const intents = await prisma.purchaseIntent.findMany({ select: { id: true, status: true, prepaidHoldTransactionId: true } });
    for (const intent of intents) {
      expect(await countKind('partner.contribution', intent.id)).toBeLessThanOrEqual(1);
      expect(await countKind('partner.bonus_redemption_compensation', intent.id)).toBeLessThanOrEqual(1);
      expect(await countKind('partner.prepaid_funding', intent.id)).toBeLessThanOrEqual(1);
      expect(await countKind('customer.prepaid.hold', intent.id)).toBeLessThanOrEqual(1);
      expect(await countKind('customer.prepaid.hold_released', intent.id)).toBeLessThanOrEqual(1);
      // A hold leaves by exactly one door.
      const released = await countKind('customer.prepaid.hold_released', intent.id);
      const settled = await countKind('partner.prepaid_funding', intent.id);
      expect(released + settled).toBeLessThanOrEqual(1);
      if (intent.prepaidHoldTransactionId && intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
        expect(released + settled).toBe(1);
      }
    }
    // No double bonus / referral: one *accrual* lot per source transaction
    // per wallet (a refund's restore lots are a different type and may
    // legitimately repeat across partial refunds).
    const lots = await prisma.bonusLot.groupBy({
      by: ['walletId', 'sourceTransactionId', 'type'],
      _count: { _all: true },
      where: {
        sourceTransactionId: { not: null },
        type: { in: [BonusEntryType.ACCRUAL_PURCHASE, BonusEntryType.ACCRUAL_REFERRAL] },
      },
    });
    for (const lot of lots) expect(lot._count._all).toBe(1);
    // No double refund: refunded total never above gross.
    for (const intent of await prisma.purchaseIntent.findMany({ select: { grossAmount: true, refundedAmount: true } })) {
      expect(intent.refundedAmount.lessThanOrEqualTo(intent.grossAmount)).toBe(true);
    }
    // No double payout: at most one paid posting per settlement.
    const paid = await prisma.ledgerTransaction.groupBy({
      by: ['sourceId'],
      where: { kind: 'partner.settlement.paid' },
      _count: { _all: true },
    });
    for (const row of paid) expect(row._count._all).toBe(1);
  };

  // ── 1–3: double taps and two phones ─────────────────────────────────────

  it('1. double-tap confirm settles once', async () => {
    const { partner, staff } = await partnerWithStaff();
    const { user } = await customer('5000', '20000');
    const intent = await openCaseD(partner.id, user.id);

    const results = await Promise.all([
      purchaseIntents.confirm(intent.id, staff.id),
      purchaseIntents.confirm(intent.id, staff.id),
      purchaseIntents.confirm(intent.id, staff.id),
    ]);
    expect(results.every((r) => r.status === PurchaseIntentStatus.CONFIRMED)).toBe(true);
    expect(await countKind('partner.contribution', intent.id)).toBe(1);
    expect(await countKind('partner.prepaid_funding', intent.id)).toBe(1);
    expect((await balance.getBalanceDetail(user.id)).available).toBe('0.0000');
    await invariants();
  });

  it('2. double-tap create opens one purchase and one hold', async () => {
    const { partner } = await partnerWithStaff();
    const { user } = await customer('5000', '20000');
    const results = await Promise.allSettled([openCaseD(partner.id, user.id), openCaseD(partner.id, user.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.purchaseIntent.count()).toBe(1);
    expect(await countKind('customer.prepaid.hold')).toBe(1);
    expect(await balance.getBalanceDetail(user.id)).toMatchObject({ available: '0.0000', reserved: '20000.0000' });
    await invariants();
  });

  it('3. two phones, same user, two businesses: the balance is spent once', async () => {
    const [a, b] = await Promise.all([partnerWithStaff(), partnerWithStaff()]);
    const { user } = await customer('0', '30000');
    const results = await Promise.allSettled([
      purchaseIntents.create({ partnerId: a.partner.id, grossAmount: '30000', prepaidAmountApplied: '30000' }, user.id),
      purchaseIntents.create({ partnerId: b.partner.id, grossAmount: '30000', prepaidAmountApplied: '30000' }, user.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await balance.getBalanceDetail(user.id)).reserved).toBe('30000.0000');
    await invariants();
  });

  // ── 5: bonus + prepaid claimed concurrently ─────────────────────────────

  it('5. two purchases each wanting all the bonus and all the balance: exactly one gets both', async () => {
    const [a, b] = await Promise.all([partnerWithStaff(), partnerWithStaff()]);
    const { user, wallet } = await customer('5000', '20000');
    const results = await Promise.allSettled([
      purchaseIntents.create({ partnerId: a.partner.id, grossAmount: '30000', bonusAmountRequested: '5000', prepaidAmountApplied: '20000' }, user.id),
      purchaseIntents.create({ partnerId: b.partner.id, grossAmount: '30000', bonusAmountRequested: '5000', prepaidAmountApplied: '20000' }, user.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const w = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedBonus.toFixed(4)).toBe('5000.0000');
    expect(w.availableBonus.toFixed(4)).toBe('0.0000');
    expect((await balance.getBalanceDetail(user.id)).reserved).toBe('20000.0000');
    // The loser released whatever it had taken: exactly one hold, no orphan.
    expect(await countKind('customer.prepaid.hold')).toBe(1);
    await invariants();
  });

  // ── 6–8: confirm vs cancel vs reject vs expiry ───────────────────────────

  it('6. cashier confirm vs customer cancel: one winner, the hold leaves by one door', async () => {
    const { partner, staff } = await partnerWithStaff();
    const { user } = await customer('5000', '20000');
    const intent = await openCaseD(partner.id, user.id);
    await Promise.allSettled([purchaseIntents.confirm(intent.id, staff.id), purchaseIntents.cancel(intent.id, user.id)]);
    const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect([PurchaseIntentStatus.CONFIRMED, PurchaseIntentStatus.CANCELLED]).toContain(row.status);
    const detail = await balance.getBalanceDetail(user.id);
    expect(detail.reserved).toBe('0.0000');
    expect(detail.available).toBe(row.status === PurchaseIntentStatus.CONFIRMED ? '0.0000' : '20000.0000');
    await invariants();
  });

  it('7. confirm vs expiry: one winner', async () => {
    const { partner, staff } = await partnerWithStaff();
    const { user } = await customer('5000', '20000');
    const intent = await openCaseD(partner.id, user.id);
    await prisma.purchaseIntent.update({ where: { id: intent.id }, data: { expiresAt: new Date(Date.now() + 200) } });
    await new Promise((r) => setTimeout(r, 250));
    await Promise.allSettled([purchaseIntents.expireStale(), purchaseIntents.confirm(intent.id, staff.id).catch(() => undefined)]);
    const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect([PurchaseIntentStatus.CONFIRMED, PurchaseIntentStatus.EXPIRED]).toContain(row.status);
    expect((await balance.getBalanceDetail(user.id)).reserved).toBe('0.0000');
    await invariants();
  });

  it('8. reject vs expiry: one winner, released once', async () => {
    const { partner, staff } = await partnerWithStaff();
    const { user } = await customer('0', '20000');
    const intent = await purchaseIntents.create({ partnerId: partner.id, grossAmount: '20000', prepaidAmountApplied: '20000' }, user.id);
    await prisma.purchaseIntent.update({ where: { id: intent.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await Promise.allSettled([
      purchaseIntents.expireStale(),
      purchaseIntents.reject(intent.id, staff.id, { reasonCode: 'X' }).catch(() => undefined),
    ]);
    const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect([PurchaseIntentStatus.REJECTED, PurchaseIntentStatus.EXPIRED]).toContain(row.status);
    expect(await countKind('customer.prepaid.hold_released', intent.id)).toBe(1);
    expect((await balance.getBalanceDetail(user.id)).available).toBe('20000.0000');
    await invariants();
  });

  // ── 9–11: crashes and lost responses ────────────────────────────────────

  it('9–10. the app dies or times out before the create commits: nothing is left half-open', async () => {
    const { partner } = await partnerWithStaff();
    const { user } = await customer('5000', '20000');
    // The transaction dies after the hold and before the row — the same
    // shape as a connection dropped mid-transaction: the bonus reservation
    // (its own committed statement) must be compensated and the hold
    // (inside the transaction) must roll back.
    const realHold = balance.holdForPurchase.bind(balance);
    const spy = jest.spyOn(balance, 'holdForPurchase').mockImplementation(async (params, tx) => {
      await realHold(params, tx);
      throw new Error('connection reset before commit');
    });
    await expect(openCaseD(partner.id, user.id)).rejects.toThrow(/connection reset/);
    spy.mockRestore();
    expect(await prisma.purchaseIntent.count()).toBe(0);
    expect(await countKind('customer.prepaid.hold')).toBe(0);
    expect((await balance.getBalanceDetail(user.id)).available).toBe('20000.0000');
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: user.id } });
    expect(w.reservedBonus.toFixed(4)).toBe('0.0000');
    // And the retry then simply works.
    const retry = await openCaseD(partner.id, user.id);
    expect(retry.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
    await invariants();
  });

  it('11. the response is lost after the confirm commits: the retry returns the same result and posts nothing', async () => {
    const { partner, staff } = await partnerWithStaff();
    const { user } = await customer('5000', '20000');
    const intent = await openCaseD(partner.id, user.id);
    await purchaseIntents.confirm(intent.id, staff.id);
    const before = await prisma.ledgerTransaction.count();
    const again = await purchaseIntents.confirm(intent.id, staff.id);
    expect(again.status).toBe(PurchaseIntentStatus.CONFIRMED);
    expect(await prisma.ledgerTransaction.count()).toBe(before);
    await invariants();
  });

  // ── 18–21: refund races ─────────────────────────────────────────────────

  const confirmedCaseD = async () => {
    const { partner, staff } = await partnerWithStaff();
    const { user } = await customer('5000', '20000');
    const intent = await openCaseD(partner.id, user.id);
    await purchaseIntents.confirm(intent.id, staff.id);
    return { partner, staff, user, intent };
  };
  const refund = (purchaseIntentId: string, actorId: string, amount?: string) =>
    refunds.refund({ purchaseIntentId, amount, reason: 'r', actorId, idempotencyKey: randomUUID() });

  it('18. two concurrent partial refunds never take more than the purchase, component by component', async () => {
    const { user, partner, staff, intent } = await confirmedCaseD();
    const results = await Promise.allSettled([refund(intent.id, staff.id, '30000'), refund(intent.id, staff.id, '30000')]);
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof refund>>> => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.refundedAmount.toFixed(4)).toBe('30000.0000');
    // 20 000 × 30 000 / 50 000 = 12 000 of the balance back, no more.
    expect((await balance.getBalanceDetail(user.id)).available).toBe('12000.0000');
    expect(await countKind('partner.prepaid_funding_refund', intent.id)).toBe(1);
    expect(partner.id).toBeTruthy();
    await invariants();
  });

  it('19. two concurrent full refunds: one refund, one set of reversing postings', async () => {
    const { user, staff, intent } = await confirmedCaseD();
    const results = await Promise.allSettled([refund(intent.id, staff.id), refund(intent.id, staff.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.purchaseIntentRefund.count()).toBe(1);
    expect(await countKind('partner.prepaid_funding_refund', intent.id)).toBe(1);
    expect((await balance.getBalanceDetail(user.id)).available).toBe('20000.0000');
    await invariants();
  });

  it('20. a full refund after a partial one returns exactly what is left of each component', async () => {
    const { user, staff, intent } = await confirmedCaseD();
    const first = await refund(intent.id, staff.id, '12345');
    const second = await refund(intent.id, staff.id);
    expect(new Decimal(first.amount).plus(second.amount).toFixed(4)).toBe('50000.0000');
    expect(new Decimal(first.prepaidRestored).plus(second.prepaidRestored).toFixed(4)).toBe('20000.0000');
    expect(new Decimal(first.bonusRestored).plus(second.bonusRestored).toFixed(4)).toBe('5000.0000');
    expect((await balance.getBalanceDetail(user.id)).available).toBe('20000.0000');
    await invariants();
  });

  it('21. a refund after a settlement DRAFT leaves the draft as it was and the reversal unclaimed', async () => {
    const { partner, staff, intent } = await confirmedCaseD();
    const maker = (await createStaffUser(prisma)).id;
    await prisma.partnerBankAccount.create({
      data: { partnerId: partner.id, beneficiaryName: 'ООО Тест', accountNumber: 'AM00', bankName: 'Тестбанк', createdByUserId: maker },
    });
    const draft = await settlements.createDraft({
      partnerId: partner.id,
      periodStart: new Date(Date.now() - 24 * 3600_000),
      periodEnd: new Date(Date.now() + 60_000),
      actorId: maker,
    });
    expect(draft.netPayableAmount.toFixed(4)).toBe('22500.0000');
    await refund(intent.id, staff.id);
    const after = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe(PartnerSettlementStatus.DRAFT);
    expect(after.netPayableAmount.toFixed(4)).toBe('22500.0000');
    const unsettled = await settlements.unsettled(partner.id);
    expect(unsettled.net.toFixed(4)).toBe('-22500.0000');
    await invariants();
  });

  // ── 23–24: collections and payouts racing purchases and refunds ─────────

  it('23. a partner collection recorded while a new purchase confirms: both post, the balance replays', async () => {
    const { partner, staff } = await partnerWithStaff();
    // The partner owes TuTak after a cash-only sale (contribution only).
    const cashOnly = await customer('0', '0');
    const first = await purchaseIntents.create({ partnerId: partner.id, grossAmount: '50000' }, cashOnly.user.id);
    await purchaseIntents.confirm(first.id, staff.id);
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('2500.0000');

    const admin = (await createStaffUser(prisma)).id;
    const hybrid = await customer('5000', '20000');
    const second = await openCaseD(partner.id, hybrid.user.id);
    await Promise.all([
      collections.record({
        partnerId: partner.id,
        amount: '2500',
        bankReference: 'REF-23',
        bankTransactionId: `TXN-${randomUUID()}`,
        actorId: admin,
        idempotencyKey: 'collect-23',
      }),
      purchaseIntents.confirm(second.id, staff.id),
    ]);
    await invariants();
  });

  it('24. a settlement paid while a refund lands: PAID stays PAID, the refund is a new unclaimed debit', async () => {
    const { partner, staff, intent } = await confirmedCaseD();
    const maker = (await createStaffUser(prisma)).id;
    const checker = (await createStaffUser(prisma)).id;
    await prisma.partnerBankAccount.create({
      data: { partnerId: partner.id, beneficiaryName: 'ООО Тест', accountNumber: 'AM00', bankName: 'Тестбанк', createdByUserId: maker },
    });
    const draft = await settlements.createDraft({
      partnerId: partner.id,
      periodStart: new Date(Date.now() - 24 * 3600_000),
      periodEnd: new Date(Date.now() + 60_000),
      actorId: maker,
    });
    await settlements.markReady(draft.id, { actorId: maker });
    await settlements.approve(draft.id, checker);
    await Promise.all([
      settlements.markPaid(draft.id, { actorId: checker, bankTransferReference: 'BANK-24' }),
      refund(intent.id, staff.id),
    ]);
    const paid = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: draft.id } });
    expect(paid.status).toBe(PartnerSettlementStatus.PAID);
    expect(await countKind('partner.settlement.paid')).toBe(1);
    expect(await countKind('partner.prepaid_funding_refund', intent.id)).toBe(1);
    expect((await settlements.unsettled(partner.id)).net.toFixed(4)).toBe('-22500.0000');
    await invariants();
  });
});
