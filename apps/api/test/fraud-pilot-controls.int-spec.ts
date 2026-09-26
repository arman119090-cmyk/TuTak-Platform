import { BonusLotStatus, FraudSignalType, PrismaClient, RoleName } from '@prisma/client';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { FraudDetectionService } from '../src/modules/security/fraud-detection.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The pilot's deterministic anti-fraud rules (docs/AI_RISK_ENGINE_DESIGN.md
 * §1-2), through the real purchase confirmation path.
 *
 * The property that matters most is what a hit does NOT do: it never refuses
 * the sale, never changes the split, never touches the partner's posting.
 * It moves one thing — when the customer may spend the green reward — and
 * leaves a FraudSignal an administrator resolves to release it early.
 *
 * Thresholds are read at boot, so the low ones this suite needs are set
 * before the harness starts and restored afterwards.
 */
describe('Pilot anti-fraud controls on purchase confirmation (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let intents: PurchaseIntentsService;
  let fraud: FraudDetectionService;
  let bonus: BonusEngineService;

  const saved = {
    high: process.env.FRAUD_HIGH_VALUE_AMOUNT,
    employee: process.env.FRAUD_EMPLOYEE_VELOCITY_MAX,
    hold: process.env.FRAUD_REWARD_HOLD_HOURS,
    newAccount: process.env.FRAUD_NEW_ACCOUNT_MAX_PURCHASES,
  };

  beforeAll(async () => {
    process.env.FRAUD_HIGH_VALUE_AMOUNT = '50000';
    process.env.FRAUD_EMPLOYEE_VELOCITY_MAX = '3';
    process.env.FRAUD_REWARD_HOLD_HOURS = '48';
    // Off here, so a fresh test customer with several purchases is not a "burst".
    process.env.FRAUD_NEW_ACCOUNT_MAX_PURCHASES = '0';
    harness = await createTestHarness();
    prisma = harness.prisma;
    intents = harness.app.get(PurchaseIntentsService);
    fraud = harness.app.get(FraudDetectionService);
    bonus = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    for (const [key, name] of [
      ['high', 'FRAUD_HIGH_VALUE_AMOUNT'],
      ['employee', 'FRAUD_EMPLOYEE_VELOCITY_MAX'],
      ['hold', 'FRAUD_REWARD_HOLD_HOURS'],
      ['newAccount', 'FRAUD_NEW_ACCOUNT_MAX_PURCHASES'],
    ] as const) {
      const value = saved[key];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function till() {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 1000 });
    const { user: staff } = await createCustomer(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
    await prisma.userRole.create({ data: { userId: staff.id, roleId: role.id, partnerId: partner.id } });
    return { partner, staff };
  }

  async function buy(partnerId: string, customerId: string, staffId: string, gross: string) {
    const intent = await intents.create({ partnerId, grossAmount: gross }, customerId);
    const confirmed = await intents.confirm(intent.id, staffId);
    expect(confirmed.status).toBe('CONFIRMED');
    return confirmed;
  }

  const greenLotOf = (sourceTransactionId: string) =>
    prisma.bonusLot.findFirstOrThrow({
      where: { sourceTransactionId, type: 'ACCRUAL_PURCHASE' },
    });

  it('leaves an ordinary purchase alone: green reward AVAILABLE at once, no signal', async () => {
    const { partner, staff } = await till();
    const { user: customer } = await createCustomer(prisma);

    const confirmed = await buy(partner.id, customer.id, staff.id, '10000');

    const lot = await greenLotOf(confirmed.sourceTransactionId!);
    expect(lot.status).toBe(BonusLotStatus.AVAILABLE);
    expect(await prisma.fraudSignal.count()).toBe(0);
  });

  it('holds the green reward of a high-value purchase and raises a HIGH signal — the sale still goes through', async () => {
    const { partner, staff } = await till();
    const { user: customer } = await createCustomer(prisma);

    const before = Date.now();
    const confirmed = await buy(partner.id, customer.id, staff.id, '60000');

    // The purchase is CONFIRMED, the partner was debited as usual…
    const payable = await prisma.ledgerAccount.findFirst({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    expect(payable).not.toBeNull();
    expect(payable!.balance.isZero()).toBe(false);

    // …and only the customer's green reward waits.
    const lot = await greenLotOf(confirmed.sourceTransactionId!);
    expect(lot.status).toBe(BonusLotStatus.PENDING);
    const holdMs = lot.availableAt.getTime() - before;
    expect(holdMs).toBeGreaterThan(47 * 3_600_000);
    expect(holdMs).toBeLessThan(49 * 3_600_000);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } });
    expect(wallet.availableBonus.isZero()).toBe(true);
    expect(wallet.pendingBonus.equals(lot.originalAmount)).toBe(true);

    const signals = await prisma.fraudSignal.findMany();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.type).toBe(FraudSignalType.BONUS_ABUSE_PATTERN);
    expect(signals[0]!.severity).toBe('HIGH');
    expect(signals[0]!.relatedTransactionId).toBe(confirmed.sourceTransactionId);
    expect(signals[0]!.metadata).toMatchObject({ rules: ['high_value'], action: 'REWARD_HOLD' });

    // The audit trail says which rule held it.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'PURCHASE_INTENT_CONFIRMED', entityId: confirmed.id },
    });
    expect(audit?.metadata).toMatchObject({ rewardHold: { rules: ['high_value'], hours: 48 } });
  });

  it('releases the held reward when an administrator resolves the signal, through the ordinary promotion sweep', async () => {
    const { partner, staff } = await till();
    const { user: customer } = await createCustomer(prisma);
    const { user: admin } = await createCustomer(prisma);
    const confirmed = await buy(partner.id, customer.id, staff.id, '60000');
    const signal = await prisma.fraudSignal.findFirstOrThrow();

    // Nothing to promote yet: the hold is in the future.
    await bonus.promotePendingLots();
    expect((await greenLotOf(confirmed.sourceTransactionId!)).status).toBe(BonusLotStatus.PENDING);

    await fraud.resolve(signal.id, admin.id);
    expect((await greenLotOf(confirmed.sourceTransactionId!)).availableAt.getTime()).toBeLessThanOrEqual(Date.now());

    await bonus.promotePendingLots();
    const lot = await greenLotOf(confirmed.sourceTransactionId!);
    expect(lot.status).toBe(BonusLotStatus.AVAILABLE);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } });
    expect(wallet.availableBonus.equals(lot.originalAmount)).toBe(true);
    expect(wallet.pendingBonus.isZero()).toBe(true);
    // Resolving twice releases nothing twice: the lot is already AVAILABLE.
    await fraud.resolve(signal.id, admin.id);
    await bonus.promotePendingLots();
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } })).availableBonus.equals(lot.originalAmount)).toBe(true);
  });

  it('holds from the employee’s N-th confirmation inside the window, with a VELOCITY signal naming the employee', async () => {
    const { partner, staff } = await till();
    const customers = await Promise.all([1, 2, 3, 4].map(() => createCustomer(prisma)));

    // Three confirmations are fine; the fourth finds three inside the window.
    for (const c of customers.slice(0, 3)) {
      const confirmed = await buy(partner.id, c.user.id, staff.id, '1000');
      expect((await greenLotOf(confirmed.sourceTransactionId!)).status).toBe(BonusLotStatus.AVAILABLE);
    }
    expect(await prisma.fraudSignal.count()).toBe(0);

    const fourth = await buy(partner.id, customers[3]!.user.id, staff.id, '1000');
    expect((await greenLotOf(fourth.sourceTransactionId!)).status).toBe(BonusLotStatus.PENDING);
    const signal = await prisma.fraudSignal.findFirstOrThrow();
    expect(signal.type).toBe(FraudSignalType.VELOCITY_LIMIT_EXCEEDED);
    expect(signal.metadata).toMatchObject({
      rules: ['employee_velocity'],
      staffUserId: staff.id,
      employeeConfirmed: 3,
    });
  });
});
