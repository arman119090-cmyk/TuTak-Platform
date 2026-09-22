import { BonusEntryType, PrismaClient, PurchaseIntentStatus, RoleName } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * A first-day launch, at the pool size CI and production run with.
 *
 * Not a benchmark. The question is the one a launch actually asks: when
 * sixty people buy at twenty shops in the same minute, with referrers
 * waiting on some of them, does every purchase confirm exactly once, does
 * every reward land, and does the ledger still sum to zero — on a
 * five-connection pool, where a single stray read outside its transaction
 * turns into a timeout cascade (see `transaction-discipline.spec.ts` for the
 * shape that already happened once). The second case is the other burst a
 * launch produces: a wave of OTP requests, which must be served rather than
 * throttled or timed out while the SMS budget still allows them.
 *
 * Numbers are printed, not asserted tightly: the assertion is correctness
 * under concurrency, plus a generous ceiling that only a starvation cascade
 * would breach.
 */
describe('Launch-scale load on the till route (integration, pool 5)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let intents: PurchaseIntentsService;
  let auth: AuthService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    intents = harness.app.get(PurchaseIntentsService);
    auth = harness.app.get(AuthService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const PARTNERS = 20;
  const PER_PARTNER = 3;
  const REFERRED = 10;

  it('confirms 60 concurrent purchases at 20 partners exactly once, rewards every referrer, and keeps the ledger at zero', async () => {
    const partnerIds: string[] = [];
    for (let i = 0; i < PARTNERS; i += 1) {
      partnerIds.push((await createPartner(prisma, { displayName: `Shop ${i}` })).id);
    }
    // One cashier who genuinely works at all twenty, because confirmation
    // re-checks standing against the database at the moment it moves money.
    // A single role row per partner is what a person working at twenty
    // partners actually has.
    const staffId = (await createStaffUser(prisma, { partnerId: partnerIds[0] })).id;
    const partnerStaffRole = await prisma.role.findFirstOrThrow({
      where: { name: RoleName.PARTNER_STAFF },
    });
    await prisma.userRole.createMany({
      data: partnerIds.slice(1).map((partnerId) => ({
        userId: staffId,
        roleId: partnerStaffRole.id,
        partnerId,
      })),
    });
    const customers = [] as { id: string; partnerId: string }[];
    for (let i = 0; i < PARTNERS * PER_PARTNER; i += 1) {
      const { user } = await createCustomer(prisma);
      customers.push({ id: user.id, partnerId: partnerIds[i % PARTNERS]! });
    }
    // The first REFERRED customers were each brought in by the same referrer.
    const { user: referrer, wallet: referrerWallet } = await createCustomer(prisma);
    await prisma.referralCode.create({ data: { userId: referrer.id, code: 'TT-LAUNCH' } });
    for (const c of customers.slice(0, REFERRED)) {
      await prisma.referralInvite.create({
        data: { referrerUserId: referrer.id, refereeUserId: c.id },
      });
    }

    const t0 = Date.now();
    const created = await Promise.all(
      customers.map((c) => intents.create({ partnerId: c.partnerId, grossAmount: '5000' }, c.id)),
    );
    const t1 = Date.now();
    const confirmed = await Promise.allSettled(
      created.map((intent) => intents.confirm(intent.id, staffId)),
    );
    const t2 = Date.now();

    const failures = confirmed.filter((r) => r.status === 'rejected');
    // Printed so a slowdown is visible in the log before it becomes a failure.
    process.stdout.write(
      `[launch-load] create x${created.length}: ${t1 - t0} ms; confirm: ${t2 - t1} ms; ` +
        `rejected: ${failures.length}\n`,
    );
    expect(failures.map((f) => (f as PromiseRejectedResult).reason)).toEqual([]);

    expect(
      await prisma.purchaseIntent.count({ where: { status: PurchaseIntentStatus.CONFIRMED } }),
    ).toBe(customers.length);
    // One purchase accrual per customer, never two.
    expect(
      await prisma.bonusLot.count({ where: { type: BonusEntryType.ACCRUAL_PURCHASE } }),
    ).toBe(customers.length);
    // Every referred purchase paid the referrer once.
    expect(
      await prisma.bonusLot.count({
        where: { walletId: referrerWallet.id, type: BonusEntryType.ACCRUAL_REFERRAL },
      }),
    ).toBe(REFERRED);
    // Debits equal credits after sixty interleaved settlements.
    const sum = await prisma.ledgerAccount.aggregate({ _sum: { balance: true } });
    expect(Number(sum._sum.balance ?? 0)).toBe(0);
    // A starvation cascade at pool 5 shows up as the 5 s interactive-transaction
    // timeout multiplied across the batch; this ceiling is far above healthy.
    expect(t2 - t0).toBeLessThan(60_000);
  });

  it('serves 50 simultaneous registration OTP requests from distinct phones and addresses', async () => {
    const phones = Array.from(
      { length: 50 },
      (_, i) => `+3749${String(1_000_000 + i).padStart(7, '0')}`,
    );
    const t0 = Date.now();
    const results = await Promise.allSettled(
      phones.map((phone, i) =>
        auth.requestRegistrationOtp({ phone }, { ipAddress: `10.0.${Math.floor(i / 250)}.${i + 1}` }),
      ),
    );
    const t1 = Date.now();
    const rejected = results.filter((r) => r.status === 'rejected');
    process.stdout.write(`[launch-load] otp x50: ${t1 - t0} ms; rejected: ${rejected.length}\n`);
    expect(rejected.map((r) => (r as PromiseRejectedResult).reason)).toEqual([]);
    expect(await prisma.authOtpToken.count()).toBe(50);
    expect(t1 - t0).toBeLessThan(30_000);
  });
});
