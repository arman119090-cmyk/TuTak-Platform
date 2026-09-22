import {
  PaymentRoute,
  PrismaClient,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The customer's history, page by page (U04/U05).
 *
 * A cursor page is "everything after this row in this order", so the order
 * has to be total. Sorting by `createdAt` alone left rows written in the
 * same millisecond unordered relative to each other, and a page boundary
 * falling between two such rows could repeat one on the next page or skip
 * it entirely. Five rows on one timestamp, paged two at a time, is the
 * smallest case that shows it.
 */
describe('transaction history paging (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let transactions: TransactionsService;
  let intents: PurchaseIntentsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    transactions = harness.app.get(TransactionsService);
    intents = harness.app.get(PurchaseIntentsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('walks every row exactly once when they all share a timestamp', async () => {
    const { user } = await createCustomer(prisma);
    const sameInstant = new Date('2026-09-20T12:00:00.000Z');
    for (let i = 0; i < 5; i++) {
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.BONUS_ACCRUAL,
          status: TransactionStatus.COMPLETED,
          amount: `${100 + i}`,
          createdAt: sameInstant,
        },
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await transactions.history({ userId: user.id, limit: 2, cursor });
      pages += 1;
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
      if (pages > 10) throw new Error('paging never terminates');
    } while (cursor);

    expect(pages).toBeGreaterThan(2);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });

  it('keeps the order total: newest first, then by id within a timestamp', async () => {
    const { user } = await createCustomer(prisma);
    const older = new Date('2026-09-19T12:00:00.000Z');
    const newer = new Date('2026-09-20T12:00:00.000Z');
    for (const at of [older, newer, newer, older]) {
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.BONUS_ACCRUAL,
          status: TransactionStatus.COMPLETED,
          amount: '1',
          createdAt: at,
        },
      });
    }
    const all = await transactions.history({ userId: user.id, limit: 10 });
    const stamps = all.items.map((row) => row.createdAt.toISOString());
    expect(stamps).toEqual([...stamps].sort().reverse());
    for (let i = 1; i < all.items.length; i++) {
      const prev = all.items[i - 1]!;
      const cur = all.items[i]!;
      if (prev.createdAt.getTime() === cur.createdAt.getTime()) {
        expect(prev.id > cur.id).toBe(true);
      }
    }
  });

  it('points a purchase row at its purchase, and other rows at nothing', async () => {
    const partner = await createPartner(prisma);
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId: partner.id, grossAmount: '15000', paymentRoute: PaymentRoute.DIRECT_PARTNER },
      customer.user.id,
    );
    await prisma.transaction.create({
      data: {
        userId: customer.user.id,
        type: TransactionType.BONUS_ACCRUAL,
        status: TransactionStatus.COMPLETED,
        amount: '50',
      },
    });

    const page = await transactions.history({ userId: customer.user.id, limit: 10 });
    const purchase = page.items.find((row) => row.type === TransactionType.PARTNER_PURCHASE);
    const accrual = page.items.find((row) => row.type === TransactionType.BONUS_ACCRUAL);
    expect(purchase?.purchaseIntentId).toBe(intent.id);
    expect(accrual?.purchaseIntentId).toBeNull();
  });
});
