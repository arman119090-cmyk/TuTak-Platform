import { LedgerAccountType, PayoutStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { PayoutHistoryService } from '../src/modules/payouts/payout-history.service';
import { SETTLEMENT_PAID_KIND } from '../src/modules/partner-settlements/settleable-kinds';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { settlementSupport } from './support/settle';

/**
 * One way out of `PARTNER_PAYABLE`.
 *
 * This file replaces `payout-engine.int-spec.ts`. The engine it tested —
 * request → BANK_CLEARING → confirm, an amount of the operator's choosing —
 * was a second payer next to `PartnerSettlementService`, and the two did not
 * see each other: the settlement engine claims only settleable kinds, so a
 * legacy payout's debit was invisible to it and the same earnings could be
 * paid twice (Launch Readiness 26.09.2026, P1). The engine is gone; what is
 * pinned here is that the money suites' "pay the partner" now means a
 * settlement, that a full cycle leaves exactly one debit of exactly one kind
 * on the payable, and that the old rows are still readable as history.
 */
describe('Partner payout — history reads and the single payer (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let history: PayoutHistoryService;
  let ledger: LedgerService;
  let settle: ReturnType<typeof settlementSupport>;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    history = harness.app.get(PayoutHistoryService);
    ledger = harness.app.get(LedgerService);
    settle = settlementSupport(harness.app, prisma);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Earns a partner a payable balance by putting real payments through. */
  const earn = async (partnerId: string, amount: string, key: string) => {
    const { user } = await createCustomer(prisma);
    return payments.capture({
      userId: user.id,
      partnerId,
      amount,
      sourceToken: 'tok_visa_test',
      idempotencyKey: key,
    });
  };

  const balanceOf = async (type: LedgerAccountType, partnerId?: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: partnerId ?? null },
    });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  const assertLedgerIntegrity = async () => {
    for (const account of await prisma.ledgerAccount.findMany()) {
      const replayed = await ledger.replayBalance(account.id);
      expect({ id: account.id, balance: account.balance.toFixed(4) }).toEqual({
        id: account.id,
        balance: replayed.toFixed(4),
      });
    }
  };

  it('reports what a partner is owed as a positive figure', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-balance-1');

    // Stored credit-normal as -9,750; a partner asking "what am I owed?"
    // should not have to know that.
    expect((await history.availableBalance(partner.id)).toFixed(4)).toBe('9750.0000');
    expect((await history.availableBalance(partner.id, 'AMD')).toFixed(4)).toBe('9750.0000');
  });

  it('reports zero for a partner who has never earned', async () => {
    const partner = await createPartner(prisma);
    expect((await history.availableBalance(partner.id)).toFixed(4)).toBe('0.0000');
  });

  // ── The one payer ─────────────────────────────────────────────────────

  it('pays a partner only through a settlement: one debit, one kind, no clearing, no Payout row', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-single-1');

    const paid = await settle.payEverything(partner.id);
    expect(paid.status).toBe('PAID');
    expect(paid.netPayableAmount.toFixed(4)).toBe('9750.0000');

    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
    expect((await history.availableBalance(partner.id)).toFixed(4)).toBe('0.0000');
    // The retired engine parked money in BANK_CLEARING between request and
    // confirmation. Nothing parks anything any more.
    expect(await balanceOf(LedgerAccountType.BANK_CLEARING)).toBe('0.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_BANK)).toBe('-9750.0000');

    const payable = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: partner.id },
    });
    const debits = await prisma.ledgerPosting.findMany({
      where: { accountId: payable.id, direction: 'DEBIT' },
      select: { amount: true, transaction: { select: { kind: true } } },
    });
    expect(debits.map((d) => `${d.transaction.kind}:${d.amount.toFixed(4)}`)).toEqual([
      `${SETTLEMENT_PAID_KIND}:9750.0000`,
    ]);
    expect(
      await prisma.ledgerTransaction.count({
        where: { kind: { in: ['payout.requested', 'payout.settled'] } },
      }),
    ).toBe(0);
    expect(await prisma.payout.count()).toBe(0);
    await assertLedgerIntegrity();
  });

  it('cannot pay the same earnings twice: the next draft finds nothing to pay', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-twice-1');
    await settle.payEverything(partner.id);

    // This is the exact sequence the two-engine defect allowed: pay, then
    // draft again. The engine sees its own `partner.settlement.paid` debit
    // (a transfer kind, never claimable) and the claimed credit, and refuses.
    await expect(settle.draftEverything(partner.id)).rejects.toThrow(/Nothing to pay/);
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('0.0000');
    await assertLedgerIntegrity();
  });

  it('refuses to draft while reconciliation has the partner blocked', async () => {
    const partner = await createPartner(prisma);
    await earn(partner.id, '10000', 'pay-blocked-1');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { payoutsBlockedAt: new Date(), payoutsBlockedReason: 'drift under investigation' },
    });

    await expect(settle.draftEverything(partner.id)).rejects.toThrow(/drift under investigation/);
    expect(await prisma.partnerSettlement.count()).toBe(0);
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('-9750.0000');
  });

  // ── History ───────────────────────────────────────────────────────────

  it('still lists the retired engine’s rows, with the two people named', async () => {
    const partner = await createPartner(prisma);
    const requester = await createStaffUser(prisma, { firstName: 'Narek', lastName: 'Hakobyan' });
    const confirmer = await createStaffUser(prisma, { firstName: 'Ani', lastName: 'Sargsyan' });
    // Rows the old path left behind: nothing on the platform writes these
    // any more, so they are inserted as the history they are.
    await prisma.payout.create({
      data: {
        partnerId: partner.id,
        amount: new Decimal('5000'),
        status: PayoutStatus.PAID,
        bankReference: 'BANK-OLD-1',
        requestedByUserId: requester.id,
        confirmedByUserId: confirmer.id,
        idempotencyKey: 'old-1',
        completedAt: new Date('2026-08-01T10:00:00.000Z'),
        createdAt: new Date('2026-08-01T09:00:00.000Z'),
      },
    });
    await prisma.payout.create({
      data: {
        partnerId: partner.id,
        amount: new Decimal('700'),
        status: PayoutStatus.FAILED,
        failureReason: 'account closed',
        requestedByUserId: 'seed-script',
        idempotencyKey: 'old-2',
        createdAt: new Date('2026-08-02T09:00:00.000Z'),
      },
    });

    const rows = await history.listForPartner(partner.id);
    expect(rows.map((r) => [r.status, r.amount.toFixed(0), r.requestedByName, r.confirmedByName])).toEqual([
      ['FAILED', '700', 'seed-script', null],
      ['PAID', '5000', 'Narek Hakobyan', 'Ani Sargsyan'],
    ]);
    // Somebody else's history is not this partner's.
    const other = await createPartner(prisma, { displayName: 'Other' });
    expect(await history.listForPartner(other.id)).toEqual([]);
  });
});
