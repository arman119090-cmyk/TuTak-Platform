import { BadRequestException } from '@nestjs/common';
import {
  BonusEntryType,
  ExternalRefundStatus,
  LedgerAccountType,
  PartnerSettlementStatus,
  PostingDirection,
  PrismaClient,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'node:crypto';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
import { PartnerCollectionService } from '../src/modules/payouts/partner-collection.service';
import {
  PurchaseIntentRefundService,
  splitRefundAcrossComponents,
} from '../src/modules/purchase-intents/purchase-intent-refund.service';
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
 * Refunds across the three funding components (owner's brief §24–26):
 * the bonus slice goes back to the wallet, the prepaid slice back to the
 * customer's money balance, and the external slice is the partner's to hand
 * back — recorded, never moved, and never called "complete" until the
 * partner says so. Same proportional watermark engine for all three, so
 * partial refunds sum exactly and can never exceed the purchase.
 */
describe('Hybrid refunds across funding components (integration)', () => {
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

  const staffMember = async (partnerId: string) => {
    const { user } = await createCustomer(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, partnerId } });
    return user;
  };

  /** Positive = TuTak owes the partner. */
  const owed = async (partnerId: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
    });
    return (account?.balance ?? new Decimal(0)).negated().toFixed(4);
  };

  const payableKinds = async (partnerId: string) => {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
      select: { amount: true, direction: true, transaction: { select: { kind: true } } },
      orderBy: { transaction: { postedAt: 'asc' } },
    });
    return postings.map((p) => `${p.transaction.kind}:${p.direction}:${p.amount.toFixed(4)}`);
  };

  /**
   * The brief's CASE D, confirmed: gross 50 000 = 5 000 bonus + 20 000
   * prepaid + 25 000 at the till, at a 5% partner. The customer starts
   * with exactly the bonus and money the purchase needs, so "everything
   * came back" reads as 5 000 / 20 000 afterwards.
   */
  const confirmedCaseD = async (money = '20000') => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
    const staff = await staffMember(partner.id);
    await engine.accrue({
      walletId: wallet.id,
      type: BonusEntryType.ACCRUAL_PURCHASE,
      amount: '5000',
      pendingHours: 0,
    });
    await fundPrepaidBalance(ledger, user.id, money);
    const intent = await purchaseIntents.create(
      {
        partnerId: partner.id,
        grossAmount: '50000',
        bonusAmountRequested: '5000',
        prepaidAmountApplied: '20000',
      },
      user.id,
    );
    const confirmed = await purchaseIntents.confirm(intent.id, staff.id);
    return { user, wallet, partner, staff, intent: confirmed };
  };

  const refund = (purchaseIntentId: string, actorId: string, amount?: string) =>
    refunds.refund({
      purchaseIntentId,
      amount,
      reason: 'returned',
      actorId,
      idempotencyKey: randomUUID(),
    });

  // ── §24: one proportional engine, three components ─────────────────────

  it('a full refund restores every component exactly and leaves the external slice for the partner', async () => {
    const { user, wallet, partner, staff, intent } = await confirmedCaseD();
    expect(await owed(partner.id)).toBe('22500.0000');

    const result = await refund(intent.id, staff.id);

    expect(result).toMatchObject({
      amount: '50000.0000',
      totalRefunded: '50000.0000',
      bonusRestored: '5000.0000',
      prepaidRestored: '20000.0000',
      externalRefundDue: '25000.0000',
      externalRefundStatus: ExternalRefundStatus.PENDING_PARTNER,
    });

    // The customer's money is back on their balance, their points in their
    // wallet; the cashback the purchase minted is gone with it.
    expect(await balance.getBalanceDetail(user.id)).toMatchObject({
      available: '20000.0000',
      reserved: '0.0000',
    });
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('5000.0000');

    // The partner's payable is back to zero by three mirror postings.
    expect(await owed(partner.id)).toBe('0.0000');
    expect(await payableKinds(partner.id)).toEqual([
      'partner.contribution:DEBIT:2500.0000',
      'partner.bonus_redemption_compensation:CREDIT:5000.0000',
      'partner.prepaid_funding:CREDIT:20000.0000',
      'partner.contribution_refund:CREDIT:2500.0000',
      'partner.bonus_redemption_compensation_refund:DEBIT:5000.0000',
      'partner.prepaid_funding_refund:DEBIT:20000.0000',
    ]);
    // §13 still holds on the way back: no bank leg for the till money.
    expect(await prisma.ledgerPosting.count({ where: { account: { type: LedgerAccountType.PLATFORM_BANK } } })).toBe(0);
  });

  it('partial refunds split each component proportionally, sum exactly, and never exceed the purchase', async () => {
    const { user, partner, staff, intent } = await confirmedCaseD();

    const parts = ['12345', '12345', '25310']; // = 50 000, deliberately awkward
    const results: Awaited<ReturnType<typeof refund>>[] = [];
    for (const amount of parts) results.push(await refund(intent.id, staff.id, amount));

    const sum = (key: 'amount' | 'bonusRestored' | 'prepaidRestored' | 'externalRefundDue') =>
      results.reduce((s, r) => s.plus(r[key]), new Decimal(0)).toFixed(4);
    expect(sum('amount')).toBe('50000.0000');
    expect(sum('bonusRestored')).toBe('5000.0000');
    expect(sum('prepaidRestored')).toBe('20000.0000');
    expect(sum('externalRefundDue')).toBe('25000.0000');
    for (const r of results) {
      expect(
        new Decimal(r.bonusRestored).plus(r.prepaidRestored).plus(r.externalRefundDue).toFixed(4),
      ).toBe(new Decimal(r.amount).toFixed(4));
    }
    expect((await balance.getBalanceDetail(user.id)).available).toBe('20000.0000');
    expect(await owed(partner.id)).toBe('0.0000');

    await expect(refund(intent.id, staff.id, '1')).rejects.toThrow(/already been refunded in full/);
  });

  it('the split is deterministic Decimal arithmetic — no float, no drift across a hundred steps', () => {
    const gross = new Decimal('50000');
    const bonus = new Decimal('5000');
    const prepaid = new Decimal('20000');
    let cumulative = new Decimal(0);
    const totals = { bonus: new Decimal(0), prepaid: new Decimal(0), external: new Decimal(0) };
    // 99 steps of 499.99 and a last step that closes the purchase exactly.
    const step = new Decimal('499.99');
    for (let i = 0; i < 100; i += 1) {
      const amount = i < 99 ? step : gross.minus(cumulative);
      const s = splitRefundAcrossComponents({
        amount,
        grossAmount: gross,
        bonusAmountRequested: bonus,
        prepaidAmountApplied: prepaid,
        cumulativeBefore: cumulative,
        cumulativeAfter: cumulative.plus(amount),
      });
      expect(s.bonus.plus(s.prepaid).plus(s.external).equals(amount)).toBe(true);
      expect(s.bonus.greaterThanOrEqualTo(0) && s.prepaid.greaterThanOrEqualTo(0)).toBe(true);
      expect(s.external.greaterThanOrEqualTo(0)).toBe(true);
      totals.bonus = totals.bonus.plus(s.bonus);
      totals.prepaid = totals.prepaid.plus(s.prepaid);
      totals.external = totals.external.plus(s.external);
      cumulative = cumulative.plus(amount);
    }
    expect(totals.bonus.equals(bonus)).toBe(true);
    expect(totals.prepaid.equals(prepaid)).toBe(true);
    expect(totals.external.equals(gross.minus(bonus).minus(prepaid))).toBe(true);
  });

  it('a purchase with nothing paid at the till has no external slice to confirm', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
    const staff = await staffMember(partner.id);
    await engine.accrue({ walletId: wallet.id, type: BonusEntryType.ACCRUAL_PURCHASE, amount: '5000', pendingHours: 0 });
    await fundPrepaidBalance(ledger, user.id, '45000');
    const intent = await purchaseIntents.create(
      { partnerId: partner.id, grossAmount: '50000', bonusAmountRequested: '5000', prepaidAmountApplied: '45000' },
      user.id,
    );
    await purchaseIntents.confirm(intent.id, staff.id);

    const result = await refund(intent.id, staff.id);
    expect(result).toMatchObject({
      prepaidRestored: '45000.0000',
      externalRefundDue: '0.0000',
      externalRefundStatus: ExternalRefundStatus.NOT_REQUIRED,
    });
    await expect(refunds.confirmExternalRefund(result.refundId, staff.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── §26: the external slice's own states ───────────────────────────────

  it('the partner confirms the cash was handed back — once, with who and when', async () => {
    const { staff, intent } = await confirmedCaseD();
    const result = await refund(intent.id, staff.id, '10000');
    expect(result.externalRefundStatus).toBe(ExternalRefundStatus.PENDING_PARTNER);

    const confirmed = await refunds.confirmExternalRefund(result.refundId, staff.id);
    expect(confirmed.externalRefundStatus).toBe(ExternalRefundStatus.CONFIRMED);
    expect(confirmed.externalRefundConfirmedByUserId).toBe(staff.id);
    expect(confirmed.externalRefundConfirmedAt).not.toBeNull();

    const other = await staffMember(intent.partnerId);
    const again = await refunds.confirmExternalRefund(result.refundId, other.id);
    // Idempotent: the first confirmation stands; the second changes nothing.
    expect(again.externalRefundConfirmedByUserId).toBe(staff.id);
    expect(again.externalRefundConfirmedAt?.getTime()).toBe(confirmed.externalRefundConfirmedAt?.getTime());
  });

  it('replaying a refund with the same key returns the same component split without a second posting', async () => {
    const { user, staff, intent } = await confirmedCaseD();
    const key = randomUUID();
    const params = { purchaseIntentId: intent.id, amount: '10000', reason: 'r', actorId: staff.id, idempotencyKey: key };
    const first = await refunds.refund(params);
    const second = await refunds.refund(params);
    expect(second).toEqual(first);
    expect(second.prepaidRestored).toBe('4000.0000');
    expect((await balance.getBalanceDetail(user.id)).available).toBe('4000.0000');
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.prepaid_funding_refund' } })).toBe(1);
  });

  // ── §25: refund after the partner was already paid ─────────────────────

  it('a refund after a PAID settlement writes new reversing postings, leaves the settlement immutable, and surfaces as money the partner owes', async () => {
    const { user, partner, staff, intent } = await confirmedCaseD();
    const maker = (await createStaffUser(prisma)).id;
    const checker = (await createStaffUser(prisma)).id;
    await prisma.partnerBankAccount.create({
      data: {
        partnerId: partner.id,
        beneficiaryName: 'ООО Тест',
        accountNumber: 'AM00 0000 0000 0000',
        bankName: 'Тестбанк',
        createdByUserId: maker,
      },
    });

    // TuTak pays the partner the 22 500 the purchase left it owing.
    const draft = await settlements.createDraft({
      partnerId: partner.id,
      periodStart: new Date(Date.now() - 24 * 3600_000),
      periodEnd: new Date(Date.now() + 60_000),
      actorId: maker,
    });
    await settlements.markReady(draft.id, { actorId: maker, documentNumber: 'DOC-1' });
    await settlements.approve(draft.id, checker);
    const paid = await settlements.markPaid(draft.id, { actorId: checker, bankTransferReference: 'BANK-1' });
    expect(paid.status).toBe(PartnerSettlementStatus.PAID);
    expect(paid.netPayableAmount.toFixed(4)).toBe('22500.0000');
    const entriesBefore = await prisma.partnerSettlementEntry.count({ where: { settlementId: draft.id } });
    expect(await owed(partner.id)).toBe('0.0000');

    // Now the customer brings everything back.
    await refund(intent.id, staff.id);

    // The paid settlement is untouched — same amount, same claimed entries.
    const paidAfter = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: draft.id } });
    expect(paidAfter.status).toBe(PartnerSettlementStatus.PAID);
    expect(paidAfter.netPayableAmount.toFixed(4)).toBe('22500.0000');
    expect(await prisma.partnerSettlementEntry.count({ where: { settlementId: draft.id } })).toBe(entriesBefore);

    // The customer got their money and points back regardless.
    expect((await balance.getBalanceDetail(user.id)).available).toBe('20000.0000');

    // And the partner now owes TuTak the 22 500 it was paid — visible as
    // unclaimed reversing postings and as a collectable amount, never as an
    // edit to history.
    expect(await owed(partner.id)).toBe('-22500.0000');
    const unsettled = await settlements.unsettled(partner.id);
    expect(unsettled.net.toFixed(4)).toBe('-22500.0000');
    expect(unsettled.unrecognised).toEqual([]);
    expect((await collections.amountOwed(partner.id)).toFixed(4)).toBe('22500.0000');
    // A new settlement cannot "pay" a negative balance — the debt stays
    // unclaimed for the collection path, exactly as the engine promises.
    await expect(
      settlements.createDraft({
        partnerId: partner.id,
        periodStart: new Date(Date.now() - 24 * 3600_000),
        periodEnd: new Date(Date.now() + 60_000),
        actorId: maker,
      }),
    ).rejects.toThrow();
  });

  it('the pre-hybrid refund path is unchanged: a bonus-only refund records a zero prepaid slice and the till slice as external', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const staff = await staffMember(partner.id);
    await engine.accrue({ walletId: wallet.id, type: BonusEntryType.ACCRUAL_PURCHASE, amount: '1000', pendingHours: 0 });
    const intent = await purchaseIntents.create(
      { partnerId: partner.id, grossAmount: '10000', bonusAmountRequested: '1000' },
      user.id,
    );
    await purchaseIntents.confirm(intent.id, staff.id);
    const result = await refund(intent.id, staff.id, '5000');
    expect(result).toMatchObject({
      bonusRestored: '500.0000',
      prepaidRestored: '0.0000',
      externalRefundDue: '4500.0000',
      externalRefundStatus: ExternalRefundStatus.PENDING_PARTNER,
    });
    expect(await prisma.ledgerPosting.count({ where: { account: { type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE } } })).toBe(0);
    // Row-level: the DB constraints accept what the engine wrote.
    const row = await prisma.purchaseIntentRefund.findUniqueOrThrow({ where: { id: result.refundId } });
    expect(row.externalRefundStatus).toBe(ExternalRefundStatus.PENDING_PARTNER);
  });
});
