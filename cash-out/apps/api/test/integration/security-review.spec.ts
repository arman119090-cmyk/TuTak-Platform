import { CryptoService } from '../../src/common/crypto/crypto.service';
import { totpCode } from '../../src/modules/admin/totp';
import {
  authorizeWithPin,
  createHarness,
  Harness,
  resetDatabase,
  seedDriver,
  seedMembership,
  seedPark,
  seedPricing,
} from '../harness';

/**
 * Regression tests for the findings of the code-level threat review
 * (docs/SECURITY_REVIEW.md). Each test is the attack, then the refusal.
 */
describe('security review findings', () => {
  let harness: Harness;
  let crypto: CryptoService;

  beforeAll(async () => {
    harness = await createHarness();
    crypto = harness.app.get(CryptoService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.rateLimiter.resetAll();
    harness.yandex.reset();
    harness.provider.reset();
    await seedPricing(harness.prisma);
  });

  it('SR-1: a quote priced for one park cannot be confirmed after switching to another', async () => {
    const driver = await seedDriver(harness, { balance: 5_000_000n });
    const other = await seedPark(harness, { yandexParkId: 'park-other' });
    await seedMembership(harness, other, {
      phone: driver.phone,
      contractorProfileId: 'c-other',
      balance: 5_000_000n,
    });
    await harness.drivers.profile(driver.userId);

    const quote = await harness.quotes.create(driver.driverId, {
      payoutMethodId: driver.payoutMethodId,
      amount: { minor: '1000000', currency: 'AMD' },
      all: false,
    });
    await harness.memberships.activate(driver.driverId, other.id, 'DRIVER', driver.userId);
    const authorizationToken = await authorizeWithPin(harness, driver, quote.quoteId);

    await expect(
      harness.withdrawals.confirm(driver.driverId, {
        quoteId: quote.quoteId,
        signature: quote.signature,
        idempotencyKey: 'sr1-park-switch',
        authorizationToken,
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_MISMATCH' });
    expect(await harness.prisma.withdrawal.count()).toBe(0);
  });

  it('SR-2: a TOTP code opens one admin session, not two', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const password = 'correct-horse-battery-staple';
    await harness.prisma.adminUser.create({
      data: {
        email: 'ops@cashout.test',
        passwordHash: crypto.hashSecret(password),
        role: 'OPERATOR',
        mfaSecretEnc: crypto.encrypt(secret),
        mfaEnabledAt: new Date(),
      },
    });
    const code = totpCode(secret, harness.clock.nowMs());

    await expect(
      harness.adminAuth.signIn('ops@cashout.test', password, code),
    ).resolves.toBeDefined();
    // Same code, seconds later: refused, and counted as a failure.
    harness.clock.advanceSeconds(5);
    await expect(
      harness.adminAuth.signIn('ops@cashout.test', password, code),
    ).rejects.toBeDefined();
    const admin = await harness.prisma.adminUser.findUniqueOrThrow({
      where: { email: 'ops@cashout.test' },
    });
    expect(admin.failedLogins).toBe(1);

    // The next step's code works.
    harness.clock.advanceSeconds(30);
    const next = totpCode(secret, harness.clock.nowMs());
    await expect(
      harness.adminAuth.signIn('ops@cashout.test', password, next),
    ).resolves.toBeDefined();
  });
});
