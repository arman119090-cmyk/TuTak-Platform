import { PaymentRoute, PrismaClient } from '@prisma/client';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What the bookkeeper gets, and whether it agrees with the books.
 *
 * The property worth testing is not "a file is produced" — it is that the
 * file *is* the ledger. An export built from a convenient rollup would be a
 * second set of numbers, and the day it disagreed somebody would have to
 * work out which one was the company's position. So the assertions compare
 * the file against the postings it claims to report.
 */
describe('Accounting exports (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let accounting: AccountingService;
  let intents: PurchaseIntentsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    accounting = harness.app.get(AccountingService);
    intents = harness.app.get(PurchaseIntentsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma)).id;
  });

  const wholeOf2026 = () =>
    accounting.parsePeriod('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');

  /** A real confirmed purchase, so the postings are ones production makes. */
  async function confirmedPurchase(gross = '15000') {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      {
        partnerId,
        grossAmount: gross,
        bonusAmountRequested: '0',
        paymentRoute: PaymentRoute.DIRECT_PARTNER,
      },
      customer.user.id,
    );
    await intents.confirm(intent.id, staffId);
    return intent;
  }


  /**
   * A PAID settlement, built the way the database insists on.
   *
   * `partner_settlements_paid_has_evidence` refuses a paid row that names no
   * ledger transaction — a settlement claiming money moved with nothing to
   * point at. Creating the transaction first is not fixture ceremony: it is
   * the constraint being right, and a fixture that dodged it would be
   * exporting a state production cannot reach.
   */
  async function paidSettlement(data: {
    partnerId: string;
    accrued: string;
    deductions: string;
    net: string;
    reference: string;
    paidAt: Date;
    periodStart: Date;
    periodEnd: Date;
  }) {
    const ledgerTransaction = await prisma.ledgerTransaction.create({
      data: { kind: 'partner.settlement.paid', sourceType: 'PartnerSettlement', sourceId: 'seed' },
    });
    return prisma.partnerSettlement.create({
      data: {
        partnerId: data.partnerId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        status: 'PAID',
        accruedAmount: data.accrued,
        deductionAmount: data.deductions,
        netPayableAmount: data.net,
        entryCount: 0,
        bankTransferReference: data.reference,
        ledgerTransactionId: ledgerTransaction.id,
        createdByUserId: staffId,
        approvedByUserId: staffId,
        approvedAt: new Date(),
        paidByUserId: staffId,
        paidAt: data.paidAt,
      },
    });
  }

  const rowsOf = (csv: string) => csv.trim().split('\r\n');

  it('writes a header even when the period is empty', async () => {
    const csv = await accounting.ledgerCsv(wholeOf2026());
    expect(rowsOf(csv)).toEqual([
      'posted_at,transaction_id,kind,source_type,source_id,account_type,partner_id,user_id,debit,credit,currency',
    ]);
  });

  /**
   * The assertion that makes the file trustworthy: every posting in the
   * period appears exactly once, and the debits sum to the credits — which
   * is the definition of the books balancing, restated in the export.
   */
  it('reports every posting, and balances', async () => {
    await confirmedPurchase();
    const csv = await accounting.ledgerCsv(wholeOf2026());
    const rows = rowsOf(csv).slice(1);

    const postingCount = await prisma.ledgerPosting.count();
    expect(rows).toHaveLength(postingCount);
    expect(postingCount).toBeGreaterThan(0);

    let debits = 0;
    let credits = 0;
    for (const row of rows) {
      const cells = row.split(',');
      // Columns 8 and 9 — see the header above. Stripped of the formula
      // guard's leading quote, which a spreadsheet would also strip.
      debits += Number((cells[8] ?? '').replace(/^'/, '') || 0);
      credits += Number((cells[9] ?? '').replace(/^'/, '') || 0);
    }
    expect(debits).toBeCloseTo(credits, 4);
    expect(debits).toBeGreaterThan(0);
  });

  it('leaves a purchase outside the period out of the file', async () => {
    await confirmedPurchase();
    const csv = await accounting.ledgerCsv(
      accounting.parsePeriod('2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z'),
    );
    expect(rowsOf(csv)).toHaveLength(1);
  });

  /**
   * Half-open periods tile. Two neighbouring months must together contain
   * every posting exactly once — no gap, no double count — which is the
   * whole reason the end is exclusive.
   */
  it('tiles: neighbouring periods together hold each posting exactly once', async () => {
    await confirmedPurchase();
    const all = rowsOf(await accounting.ledgerCsv(wholeOf2026())).slice(1);

    const now = new Date();
    const boundary = new Date(now.getTime() + 1000).toISOString();
    const before = rowsOf(
      await accounting.ledgerCsv(accounting.parsePeriod('2026-01-01T00:00:00.000Z', boundary)),
    ).slice(1);
    const after = rowsOf(
      await accounting.ledgerCsv(accounting.parsePeriod(boundary, '2027-01-01T00:00:00.000Z')),
    ).slice(1);

    expect(before.length + after.length).toBe(all.length);
    expect(new Set([...before, ...after]).size).toBe(all.length);
  });

  it('refuses a period that ends before it starts', () => {
    expect(() =>
      accounting.parsePeriod('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ).toThrow(/until must be after from/);
  });

  it('refuses a period that is not dates at all', () => {
    expect(() => accounting.parsePeriod('last tuesday', 'soon')).toThrow(/ISO dates/);
  });

  /**
   * A partner whose legal name is a spreadsheet formula. The name is stored
   * as typed and exported as stored — with the leading quote that stops a
   * spreadsheet evaluating it.
   */
  it('neutralises a partner name that is really a formula', async () => {
    // `createPartner` does not expose `legalName`, so it is set directly —
    // the point is what the exporter does with a hostile value already in
    // the database, however it got there.
    const hostile = await createPartner(prisma);
    await prisma.partner.update({
      where: { id: hostile.id },
      data: { legalName: '=HYPERLINK("http://evil","Click")' },
    });
    await paidSettlement({
      partnerId: hostile.id,
      accrued: '1000',
      deductions: '0',
      net: '1000',
      reference: 'BANK-1',
      paidAt: new Date('2026-06-01'),
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
    });

    const csv = await accounting.settlementsCsv(wholeOf2026());
    expect(csv).toContain("'=HYPERLINK");
    // And never the live form, which is what a spreadsheet would run.
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/);
  });

  it('reports a paid settlement with the figures it was paid on', async () => {
    await paidSettlement({
      partnerId,
      accrued: '20000',
      deductions: '1500',
      net: '18500',
      reference: 'TRF-42',
      paidAt: new Date('2026-03-02'),
      periodStart: new Date('2026-02-01'),
      periodEnd: new Date('2026-02-28'),
    });

    const rows = rowsOf(await accounting.settlementsCsv(wholeOf2026()));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('18500.0000');
    expect(rows[1]).toContain('TRF-42');
  });
});
