import { PaymentRoute, PrismaClient, PurchaseIntentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The preflight that keeps a deploy from becoming a data-loss event.
 *
 * `purchase_intents_one_live_per_customer_partner` cannot be created while a
 * customer has two unfinished purchases at one business. The tempting fix is
 * a `UPDATE ... SET status = 'EXPIRED'` at the top of the migration, and
 * the product decision of 15.09.2026 forbids it: a customer standing at a till
 * with a live purchase is not a data-quality problem to be tidied away.
 * Expiring their purchase from a deploy script releases their reserved points
 * and voids a code they are about to read out, with nobody watching.
 *
 * So the migration checks, refuses with instructions, and changes nothing.
 * The documented rollout — drain, wait out the timeout, let the sweep run,
 * verify — is what clears it, using the ordinary paths that write audit rows.
 */
describe('Migration preflight: one live purchase per customer/partner', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let intents: PurchaseIntentsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
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

  type Offender = {
    customerId: string;
    partnerId: string;
    liveCount: bigint;
    purchaseIds: string[];
  };

  const preflight = () =>
    prisma.$queryRawUnsafe<Offender[]>('SELECT * FROM "tutak_preflight_one_live_purchase"()');

  const INDEX = 'purchase_intents_one_live_per_customer_partner';

  /** Put the database back the way the suite found it. */
  afterEach(async () => {
    await prisma
      .$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}"
           ON "purchase_intents" ("customerId", "partnerId")
           WHERE "status" = 'AWAITING_CONFIRMATION'`,
      )
      .catch(() => undefined);
  });

  /**
   * Two live purchases for one customer at one business.
   *
   * The index has to come off first, and that is not a trick to make the test
   * pass — it is the situation the preflight exists for. A database that
   * already has the index cannot contain duplicates; the one being migrated
   * has no index yet and may well contain them, and nothing in the running
   * code can produce that state any more. So the fixture removes the index,
   * fabricates the history, and the `afterEach` above puts it back.
   */
  async function twoLivePurchases() {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDEX}"`);
    const customer = await createCustomer(prisma);
    const first = await intents.create({ partnerId, grossAmount: '5000' }, customer.user.id);
    const second = await prisma.$executeRawUnsafe(
      `INSERT INTO "purchase_intents"
         ("id", "customerId", "partnerId", "status", "confirmationCode", "grossAmount",
          "bonusAmountRequested", "ordinaryPaymentRemainder", "negotiatedRateBps",
          "maxBonusPaymentPercent", "paymentRoute", "expiresAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'AWAITING_CONFIRMATION', '4242', 7000,
               0, 7000, 500, 100, 'DIRECT_PARTNER', now() + interval '3 minutes')`,
      customer.user.id,
      partnerId,
    );
    expect(second).toBe(1);
    return { customer, first };
  }

  it('reports nothing on a healthy database', async () => {
    const customer = await createCustomer(prisma);
    await intents.create({ partnerId, grossAmount: '5000' }, customer.user.id);
    const other = await createPartner(prisma, { displayName: 'Elsewhere' });
    await intents.create({ partnerId: other.id, grossAmount: '5000' }, customer.user.id);

    expect(await preflight()).toHaveLength(0);
  });

  it('names the customer, the business and the purchases when there are duplicates', async () => {
    const { customer, first } = await twoLivePurchases();

    const offenders = await preflight();
    expect(offenders).toHaveLength(1);
    expect(offenders[0]?.customerId).toBe(customer.user.id);
    expect(offenders[0]?.partnerId).toBe(partnerId);
    expect(Number(offenders[0]?.liveCount)).toBe(2);
    // The ids are in the result so whoever is running the deploy can look at
    // the actual purchases rather than guess.
    expect(offenders[0]?.purchaseIds).toContain(first.id);
  });

  it('refuses to create the index while duplicates exist, and says what to do', async () => {
    await twoLivePurchases();

    // Exactly what the migration does, replayed: check first, and refuse with
    // the procedure rather than a raw 23505 nobody can act on.
    await expect(
      prisma.$executeRawUnsafe(`
        DO $$
        DECLARE offenders integer;
        BEGIN
          SELECT count(*) INTO offenders FROM "tutak_preflight_one_live_purchase"();
          IF offenders > 0 THEN
            RAISE EXCEPTION 'Cannot create index: % pair(s). Follow the rollout: drain, wait out the purchase timeout, let purchase-intent.expire run, then re-check.', offenders;
          END IF;
        END $$;
      `),
    ).rejects.toThrow(/Follow the rollout/i);

    // And nothing was touched: both purchases are exactly as they were.
    const live = await prisma.purchaseIntent.count({
      where: { status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
    });
    expect(live).toBe(2);
  });

  it('clears once the ordinary expiry sweep has run, which is the documented rollout', async () => {
    const { customer } = await twoLivePurchases();
    expect(await preflight()).toHaveLength(1);

    // Step 2 of the rollout: the purchase timeout passes. Step 3: the sweep
    // that already runs every thirty seconds closes them, releasing
    // reservations through the path that writes audit rows.
    await prisma.purchaseIntent.updateMany({
      where: { customerId: customer.user.id, status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await intents.expireStale();
    expect(expired).toBe(2);

    // Step 4: verify. Now the index can be created.
    expect(await preflight()).toHaveLength(0);
  });

  it('does not count a purchase held open by an unresolved payment as clearable', async () => {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
      customer.user.id,
    );
    await intents.approveForPayment(intent.id, staffId, {});
    await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: 'INITIATED',
        amount: new Decimal('15000'),
        providerBillId: 'bill-preflight',
        liveKey: 'live',
      },
    });
    await prisma.purchaseIntent.update({
      where: { id: intent.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // The sweep deliberately leaves it alone, so waiting will not clear it.
    // That is exactly why the rollout says these are resolved by the provider
    // or by a two-person reconciliation and never forced.
    expect(await intents.expireStale()).toBe(0);
    expect(
      (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
    ).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
    // One purchase is not a duplicate, so it does not block the index either.
    expect(await preflight()).toHaveLength(0);
  });
});
