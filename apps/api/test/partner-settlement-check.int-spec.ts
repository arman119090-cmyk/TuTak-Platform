import { LedgerAccountType, PostingDirection, PrismaClient } from '@prisma/client';
import { PartnerSettlementCheckService } from '../src/modules/payouts/partner-settlement-check.service';
import { PartnerCollectionService } from '../src/modules/payouts/partner-collection.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60_000;

/**
 * The biweekly settlement check — doc §2/§7's periodic netting, made
 * visible. Read-only: every assertion here is about which partners get an
 * alert and what it says, never about a balance moving, because this sweep
 * must never move one.
 */
describe('PartnerSettlementCheckService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let check: PartnerSettlementCheckService;
  let ledger: LedgerService;
  let collections: PartnerCollectionService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    check = harness.app.get(PartnerSettlementCheckService);
    ledger = harness.app.get(LedgerService);
    collections = harness.app.get(PartnerCollectionService);
  });

  afterAll(async () => {
    await harness.close();
  });

  // Real `User` rows for the maker-checker tests below — see
  // `createStaffUser`'s own docblock for why `confirm` needs them.
  let admin1 = '';
  let admin2 = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    await harness.resetAlerts();
    jest.restoreAllMocks();
    const [a1, a2] = await Promise.all([createStaffUser(prisma), createStaffUser(prisma)]);
    admin1 = a1.id;
    admin2 = a2.id;
  });

  /** Posts a real balance for `partnerId` — positive `amount` means TuTak owes them. */
  const seedBalance = async (partnerId: string, amount: string) => {
    const [partnerAccount, revenueAccount] = await Promise.all([
      ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }),
    ]);
    // CREDIT moves the credit-normal balance negative — TuTak owing the
    // partner — for a positive `amount`; DEBIT (a negative `amount` here)
    // does the reverse. Either way this mirrors a real posting, not a raw
    // balance write.
    const owedToPartner = Number(amount) >= 0;
    await ledger.post({
      kind: 'test.seed_balance',
      sourceType: 'Test',
      sourceId: partnerId,
      postings: [
        {
          accountId: partnerAccount.id,
          direction: owedToPartner ? PostingDirection.CREDIT : PostingDirection.DEBIT,
          amount: Math.abs(Number(amount)).toString(),
        },
        {
          accountId: revenueAccount.id,
          direction: owedToPartner ? PostingDirection.DEBIT : PostingDirection.CREDIT,
          amount: Math.abs(Number(amount)).toString(),
        },
      ],
    });
  };

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000);

  it('does nothing for a partner with a zero balance, however long ago they last settled', async () => {
    const partner = await createPartner(prisma);
    await prisma.partner.update({
      where: { id: partner.id },
      data: { lastSettledAt: daysAgo(365) },
    });

    const result = await check.checkOverdueSettlements();

    expect(result.overdue).toBe(0);
    expect(harness.alerts.matching(`partner.settlement-due:${partner.id}`)).toHaveLength(0);
  });

  it('notifies when TuTak owes the partner and the window has elapsed', async () => {
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '3800');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { lastSettledAt: daysAgo(20) },
    });

    const result = await check.checkOverdueSettlements();

    expect(result.overdue).toBe(1);
    const [alert] = harness.alerts.matching(`partner.settlement-due:${partner.id}`);
    expect(alert).toBeDefined();
    expect(alert!.context?.direction).toBe('tutak_owes_partner');
    expect(alert!.context?.netAmount).toBe('3800.0000');
  });

  it('notifies when the partner owes TuTak and the window has elapsed', async () => {
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '-1200');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { lastSettledAt: daysAgo(20) },
    });

    const result = await check.checkOverdueSettlements();

    expect(result.overdue).toBe(1);
    const [alert] = harness.alerts.matching(`partner.settlement-due:${partner.id}`);
    expect(alert!.context?.direction).toBe('partner_owes_tutak');
    expect(alert!.context?.netAmount).toBe('1200.0000');
  });

  it('gives a brand-new balance a fresh cycle rather than an immediate alert', async () => {
    // Problem 2b: `lastSettledAt` is no longer just "null until someone
    // settles" — `LedgerService` itself stamps it the moment a balance is
    // born (zero → non-zero), so this partner's very first debt already has
    // a known start date and is not instantly, noisily "overdue" on day
    // zero. See the "reflects the real balance" describe block below for
    // the full zero-crossing behaviour.
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '500');

    const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stored.lastSettledAt).not.toBeNull();

    const result = await check.checkOverdueSettlements();

    expect(result.overdue).toBe(0);
    expect(harness.alerts.matching(`partner.settlement-due:${partner.id}`)).toHaveLength(0);
  });

  it('still treats a genuinely unknown cycle start (null lastSettledAt) as immediately due', async () => {
    // The one legitimate way `lastSettledAt` stays null with a real balance
    // on the books: a partner whose balance predates this column entirely,
    // for whom there is no true cycle-start date to backfill (see the
    // column's own migration). `LedgerService` cannot invent history for a
    // partner it never saw move, so this partner is exactly what the
    // null-is-overdue fallback exists to protect.
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '500');
    await prisma.partner.update({ where: { id: partner.id }, data: { lastSettledAt: null } });

    const result = await check.checkOverdueSettlements();

    expect(result.overdue).toBe(1);
    expect(harness.alerts.matching(`partner.settlement-due:${partner.id}`)).toHaveLength(1);
  });

  it('says nothing about a partner settled within the last 14 days', async () => {
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '500');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { lastSettledAt: daysAgo(3) },
    });

    const result = await check.checkOverdueSettlements();

    expect(result.checked).toBe(0);
    expect(harness.alerts.matching(`partner.settlement-due:${partner.id}`)).toHaveLength(0);
  });

  it('is silent right at the boundary and fires just past it', async () => {
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '500');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { lastSettledAt: new Date(Date.now() - FOURTEEN_DAYS_MS + 60_000) },
    });

    expect((await check.checkOverdueSettlements()).overdue).toBe(0);

    await prisma.partner.update({
      where: { id: partner.id },
      data: { lastSettledAt: new Date(Date.now() - FOURTEEN_DAYS_MS - 60_000) },
    });

    expect((await check.checkOverdueSettlements()).overdue).toBe(1);
  });

  it('ignores a deactivated partner even with a real, overdue balance', async () => {
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '500');
    await prisma.partner.update({
      where: { id: partner.id },
      data: { isActive: false, lastSettledAt: daysAgo(30) },
    });

    const result = await check.checkOverdueSettlements();

    expect(result.overdue).toBe(0);
    expect(harness.alerts.matching(`partner.settlement-due:${partner.id}`)).toHaveLength(0);
  });

  it('never touches a balance — this sweep is read-only', async () => {
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '3800');
    const originalLastSettledAt = daysAgo(20);
    await prisma.partner.update({
      where: { id: partner.id },
      data: { lastSettledAt: originalLastSettledAt },
    });

    await check.checkOverdueSettlements();

    const account = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: partner.id },
    });
    expect(account.balance.negated().toFixed(4)).toBe('3800.0000');
    // Nor does it touch the clock it reads from — only a real payout or
    // collection resets `lastSettledAt`.
    const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stored.lastSettledAt!.getTime()).toBe(originalLastSettledAt.getTime());
  });

  it('checks several overdue partners in one pass and counts both figures correctly', async () => {
    const withBalance = await createPartner(prisma);
    const withoutBalance = await createPartner(prisma);
    await seedBalance(withBalance.id, '1000');
    await prisma.partner.updateMany({
      where: { id: { in: [withBalance.id, withoutBalance.id] } },
      data: { lastSettledAt: daysAgo(30) },
    });

    const result = await check.checkOverdueSettlements();

    expect(result.checked).toBe(2);
    expect(result.overdue).toBe(1);
    expect(harness.alerts.matching(`partner.settlement-due:${withBalance.id}`)).toHaveLength(1);
    expect(harness.alerts.matching(`partner.settlement-due:${withoutBalance.id}`)).toHaveLength(0);
  });

  // ── Problem 2b: lastSettledAt reflects the real balance, not any activity ──
  //
  // These prove the actual defect the brief describes: a partial payment
  // used to reset `lastSettledAt` unconditionally, which pulled the partner
  // out of `duePartners`' candidate pool for a full 14 days regardless of
  // how much they still owed — see `PartnerSettlementCheckService`'s query,
  // which filters *before* it ever looks at the live balance.

  describe('the settlement clock reflects the real balance (Problem 2b)', () => {
    it('is not reset by a 1 AMD partial collection against a much larger debt', async () => {
      const partner = await createPartner(prisma);
      await seedBalance(partner.id, '-500000'); // partner owes TuTak 500,000
      // Simulate that this debt has genuinely sat unsettled for 20 days.
      const settledAt = daysAgo(20);
      await prisma.partner.update({
        where: { id: partner.id },
        data: { lastSettledAt: settledAt },
      });

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '1',
        bankReference: 'SWIFT-TOKEN-PAYMENT',
        bankTransactionId: 'CLOCK-TEST-PARTIAL-1',
        actorId: admin1,
        idempotencyKey: 'clock-partial-1',
      });
      await collections.confirm(recorded.collectionId, admin2);

      // The balance barely moved, and neither did the clock — a 1 AMD
      // payment must not buy 14 more days of silence on 499,999 AMD.
      const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
      expect(stored.lastSettledAt!.getTime()).toBe(settledAt.getTime());

      const result = await check.checkOverdueSettlements();
      expect(result.overdue).toBe(1);
      const [alert] = harness.alerts.matching(`partner.settlement-due:${partner.id}`);
      expect(alert!.context?.direction).toBe('partner_owes_tutak');
      expect(alert!.context?.netAmount).toBe('499999.0000');
    });

    it('resets the cycle on a full settlement to zero', async () => {
      const partner = await createPartner(prisma);
      await seedBalance(partner.id, '-500');
      await prisma.partner.update({
        where: { id: partner.id },
        data: { lastSettledAt: daysAgo(20) },
      });

      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-FULL-SETTLE',
        bankTransactionId: 'CLOCK-TEST-FULL-1',
        actorId: admin1,
        idempotencyKey: 'clock-full-1',
      });
      await collections.confirm(recorded.collectionId, admin2);

      const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
      expect(Date.now() - stored.lastSettledAt!.getTime()).toBeLessThan(10_000);

      // And the sweep agrees there is nothing left to chase.
      const result = await check.checkOverdueSettlements();
      expect(result.overdue).toBe(0);
    });

    it('starts a clean, fresh cycle when a new balance appears after a full settlement', async () => {
      const partner = await createPartner(prisma);
      await seedBalance(partner.id, '-500');
      const recorded = await collections.record({
        partnerId: partner.id,
        amount: '500',
        bankReference: 'SWIFT-FULL-SETTLE-2',
        bankTransactionId: 'CLOCK-TEST-FULL-2',
        actorId: admin1,
        idempotencyKey: 'clock-full-2',
      });
      await collections.confirm(recorded.collectionId, admin2);

      // The partner then sat quiet, genuinely settled, for a long time.
      await prisma.partner.update({
        where: { id: partner.id },
        data: { lastSettledAt: daysAgo(200) },
      });

      // A brand-new debt is born today.
      await seedBalance(partner.id, '-300');

      // The clock must read "today", not the 200-day-old settlement date —
      // otherwise this partner would look instantly, wrongly overdue on a
      // debt that is zero days old.
      const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
      expect(Date.now() - stored.lastSettledAt!.getTime()).toBeLessThan(10_000);

      const result = await check.checkOverdueSettlements();
      expect(result.overdue).toBe(0);
      expect(harness.alerts.matching(`partner.settlement-due:${partner.id}`)).toHaveLength(0);
    });
  });
});
