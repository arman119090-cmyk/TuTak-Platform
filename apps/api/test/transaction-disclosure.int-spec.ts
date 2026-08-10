import { PrismaClient, TransactionStatus, TransactionType } from '@prisma/client';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What a transaction row discloses.
 *
 * The history query returned the whole Prisma row. Two endpoints read it:
 * `/transactions/me`, where a customer sees their own, and
 * `/partners/:id/transactions`, where a merchant sees other people's. Both
 * were being handed `idempotencyKey` — the identifier that replays a
 * request — which neither has any use for, and which no client type even
 * declares, so nothing would have noticed if it changed or disappeared.
 *
 * Keys are scoped to the owning user, so a merchant holding a customer's key
 * cannot spend it. That containment lives in the schema's unique constraint,
 * not in this query, and it is not a reason to publish the key.
 *
 * The reason this test exists past that one field is the next column added to
 * the model. `findMany` with no projection publishes by default, and a
 * default of "publish" fails silently and in the wrong direction. The list
 * below is the contract; a new column has to be added here deliberately
 * before a customer or a merchant can see it.
 */
describe('Transaction disclosure (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let transactions: TransactionsService;

  /** Exactly what `TransactionDto` in @tutak/shared-types declares. */
  const DECLARED = [
    'id',
    'userId',
    'partnerId',
    'type',
    'status',
    'amount',
    'currency',
    'bonusAppliedAmount',
    'bonusEarnedAmount',
    'description',
    'metadata',
    'createdAt',
    'updatedAt',
  ];

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const givenAPayment = async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);

    await prisma.transaction.create({
      data: {
        userId: user.id,
        partnerId: partner.id,
        type: TransactionType.QR_PAYMENT,
        status: TransactionStatus.COMPLETED,
        amount: '5000',
        bonusEarnedAmount: '250',
        idempotencyKey: 'the-key-that-replays-this-payment',
      },
    });

    return { userId: user.id, partnerId: partner.id };
  };

  it('does not hand a customer the key that replays their own payment', async () => {
    const { userId } = await givenAPayment();

    const { items } = await transactions.history({ userId, limit: 20 });

    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('idempotencyKey');
  });

  it("does not hand a merchant the keys of its customers' payments", async () => {
    // The one that actually crosses a person boundary: this list is other
    // people's transactions, read by the business they paid.
    const { partnerId } = await givenAPayment();

    const { items } = await transactions.history({ partnerId, limit: 20 });

    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('idempotencyKey');
  });

  it('returns exactly the fields the shared type declares — no more, no fewer', async () => {
    const { userId } = await givenAPayment();

    const { items } = await transactions.history({ userId, limit: 20 });
    const row = items[0];
    if (!row) throw new Error('the fixture payment was not returned');

    // Both directions on purpose. Extra keys are the leak this file is about;
    // missing keys break every client silently, because a `string | null`
    // field that is simply absent reads as null on the screen.
    expect(Object.keys(row).sort()).toEqual([...DECLARED].sort());
  });

  it('still returns what the screens are built on', async () => {
    // A projection that drops a field somebody renders is a worse outcome
    // than the leak, so the useful half is asserted rather than assumed.
    const { userId } = await givenAPayment();

    const { items } = await transactions.history({ userId, limit: 20 });

    expect(items[0]).toMatchObject({
      type: TransactionType.QR_PAYMENT,
      status: TransactionStatus.COMPLETED,
    });
    expect(items[0]?.amount.toString()).toBe('5000');
    expect(items[0]?.bonusEarnedAmount.toString()).toBe('250');
  });

  it('still pages', async () => {
    // `select` and `cursor` are set on the same call; a cursor needs the id,
    // and dropping it from the projection would break paging quietly at the
    // second page rather than the first.
    const { user } = await createCustomer(prisma);
    for (let i = 0; i < 3; i++) {
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.QR_PAYMENT,
          status: TransactionStatus.COMPLETED,
          amount: `${100 + i}`,
        },
      });
    }

    const first = await transactions.history({ userId: user.id, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1]?.id);

    const second = await transactions.history({
      userId: user.id,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.items[0]?.id).not.toBe(first.items[1]?.id);
  });
});
