/**
 * Seeds the rows the product cannot start without: a fee schedule, a limit
 * policy, and one administrator.
 *
 * Deliberately *not* seeded: drivers, payout methods or withdrawals. Fabricated
 * money data in a real database is how a demo number ends up in a board deck.
 * Run `pnpm --filter @cashout/api demo` for a self-contained mock walkthrough.
 */
import { AdminRole, PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(secret.normalize('NFKC'), salt, 32, SCRYPT);
  return `s1:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

async function main(): Promise<void> {
  const currency = 'AMD';

  const existingFees = await prisma.feeSchedule.findFirst({
    where: { parkId: null, currency, effectiveTo: null },
  });
  if (!existingFees) {
    await prisma.feeSchedule.create({
      data: {
        parkId: null,
        currency,
        // 2.00% + 50 AMD, floor 100 AMD, cap 5 000 AMD.
        platformRateNumerator: 200n,
        platformRateDenominator: 10_000n,
        platformFixedMinor: 5_000n,
        platformMinMinor: 10_000n,
        platformMaxMinor: 500_000n,
        platformRounding: 'HALF_UP',
        // 0.60% + 10 AMD — a placeholder until a real PSP quotes us.
        providerRateNumerator: 60n,
        providerRateDenominator: 10_000n,
        providerFixedMinor: 1_000n,
        providerRounding: 'HALF_UP',
        payoutIncrementMinor: 1n,
      },
    });
    console.log('seeded: default fee schedule (AMD)');
  }

  const existingLimits = await prisma.limitPolicy.findFirst({
    where: { parkId: null, currency, effectiveTo: null },
  });
  if (!existingLimits) {
    await prisma.limitPolicy.create({
      data: {
        parkId: null,
        currency,
        minWithdrawalMinor: 100_000n, //   1 000 AMD
        maxWithdrawalMinor: 30_000_000n, // 300 000 AMD
        dailyAmountMinor: 50_000_000n, //  500 000 AMD
        dailyCountMax: 5,
        weeklyAmountMinor: 150_000_000n,
        monthlyAmountMinor: 400_000_000n,
        velocityWindowSeconds: 3600,
        velocityMaxCount: 3,
        manualReviewAboveMinor: 20_000_000n, // 200 000 AMD
      },
    });
    console.log('seeded: default limit policy (AMD)');
  }

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (email && password) {
    const existing = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!existing) {
      await prisma.adminUser.create({
        data: {
          email: email.toLowerCase(),
          passwordHash: hashSecret(password),
          role: AdminRole.ADMIN,
        },
      });
      console.log(`seeded: admin ${email} (set up two-factor before using it)`);
    }
  } else {
    console.log(
      'skipped: no admin created — set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD',
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
