import { LedgerAccountType, PostingDirection, PrismaClient } from '@prisma/client';
import { PartnerSettlementCheckService } from '../src/modules/payouts/partner-settlement-check.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createPartner } from './setup/fixtures';
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

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    check = harness.app.get(PartnerSettlementCheckService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await harness.resetAlerts();
    jest.restoreAllMocks();
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

  it('treats a partner never settled as immediately due', async () => {
    const partner = await createPartner(prisma);
    await seedBalance(partner.id, '500');
    expect(partner.lastSettledAt).toBeNull();

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
});
