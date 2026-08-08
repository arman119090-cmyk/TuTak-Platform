import { BadRequestException } from '@nestjs/common';
import { LedgerDirection, PrismaClient } from '@prisma/client';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Limits on minting points.
 *
 * A manual adjustment is the only path where a caller-supplied number becomes
 * loyalty points with nothing bounding it: a payment's accrual is bounded by
 * what the acquirer captured, an EV session by the physical limits of a
 * meter, a referral by a constant. Points are a liability the business owes,
 * so "an administrator can create any number of them in one request" is a
 * control gap rather than a feature — one extra keystroke, or one stolen
 * session, and the balance sheet has a hole in it.
 *
 * Found by probing the running API, not by reading the code: the request went
 * through validation, reached Postgres, and came back as a 500 from
 * `numeric field overflow`.
 */
describe('Minting ceiling (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let bonus: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    bonus = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('refuses a single adjustment above the ceiling', async () => {
    const customer = await createCustomer(prisma);

    await expect(
      bonus.manualAdjustment(customer.wallet.id, '2000000', LedgerDirection.CREDIT, 'too much'),
    ).rejects.toThrow(BadRequestException);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    expect(wallet.availableBonus.toFixed(4)).toBe('0.0000');
    expect(wallet.pendingBonus.toFixed(4)).toBe('0.0000');
  });

  it('still allows an adjustment a real correction would need', async () => {
    const customer = await createCustomer(prisma);

    await bonus.manualAdjustment(customer.wallet.id, '5000', LedgerDirection.CREDIT, 'goodwill');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    // Credited with pendingHours 0, so it lands available immediately.
    expect(wallet.availableBonus.toFixed(4)).toBe('5000.0000');
  });

  it('refuses an amount that would overflow the column instead of crashing', async () => {
    const customer = await createCustomer(prisma);

    // Inside Decimal(18,4)'s maximum as an *input*, so it passes the money
    // parser; the resulting balance is what does not fit. This used to reach
    // Postgres and return a 500.
    await expect(
      bonus.manualAdjustment(
        customer.wallet.id,
        '99999999999999',
        LedgerDirection.CREDIT,
        'overflow',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an accrual that would overflow a wallet already near the limit', async () => {
    const customer = await createCustomer(prisma);

    // Put the wallet just under the ceiling by writing the balance directly —
    // the point is to test the guard in the ledger write path, not the route
    // that got it there.
    await prisma.wallet.update({
      where: { id: customer.wallet.id },
      data: { availableBonus: '99999999999000' },
    });

    await expect(
      bonus.accrue({
        walletId: customer.wallet.id,
        type: 'ACCRUAL_MANUAL_ADJUSTMENT',
        amount: '2000',
        pendingHours: 0,
        metadata: { reason: 'tips it over' },
      }),
    ).rejects.toThrow(BadRequestException);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    expect(wallet.availableBonus.toFixed(4)).toBe('99999999999000.0000');
  });
});
