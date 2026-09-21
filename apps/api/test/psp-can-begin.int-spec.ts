import {
  BonusEntryType,
  PaymentRoute,
  PrismaClient,
  PurchaseIntentStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What the customer's app is told about whether it may pay (U03).
 *
 * The status endpoint previews the same decision `beginAttempt` makes, so
 * the screen can name the actual obstacle — the cashier, an expired
 * purchase, a switched-off provider, an unresolved earlier attempt — instead
 * of blaming the cashier for every refusal. Each case here asserts two
 * things: the preview names the reason, and the real call agrees with it.
 */
describe('customer payment status: canBeginPayment (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;
  let bonusEngine: BonusEngineService;
  let config: ConfigService;

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY'] as const) {
      savedEnv[key] = process.env[key];
    }
    process.env.IDRAM_MERCHANT_ID = '111222333';
    process.env.IDRAM_SECRET_KEY = 'test-idram-secret';

    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
    bonusEngine = harness.app.get(BonusEngineService);
    config = harness.app.get(ConfigService);
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma)).id;
  });

  async function providerPurchase(gross = '15000', bonus = '0') {
    const customer = await createCustomer(prisma);
    if (Number(bonus) > 0) {
      await bonusEngine.accrue({
        walletId: customer.wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: bonus,
        pendingHours: 0,
      });
    }
    const intent = await intents.create(
      {
        partnerId,
        grossAmount: gross,
        ...(Number(bonus) > 0 ? { bonusAmountRequested: bonus } : {}),
        paymentRoute: PaymentRoute.TUTAK_PSP,
      },
      customer.user.id,
    );
    return { customer, intent };
  }

  it('names the till route as the reason on a purchase paid at the till', async () => {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.DIRECT_PARTNER },
      customer.user.id,
    );
    const status = await psp.customerPaymentStatus(intent.id, customer.user.id);
    expect(status).toMatchObject({
      state: 'NOT_APPLICABLE',
      canBeginPayment: false,
      reason: 'NOT_ROUTED',
      purchaseStatus: PurchaseIntentStatus.AWAITING_CONFIRMATION,
    });
    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
    ).rejects.toThrow(/not routed through a payment provider/i);
  });

  it('says the cashier has not agreed yet — and only then', async () => {
    const { customer, intent } = await providerPurchase();
    const before = await psp.customerPaymentStatus(intent.id, customer.user.id);
    expect(before).toMatchObject({
      state: 'NOT_STARTED',
      canBeginPayment: false,
      reason: 'AWAITING_MERCHANT_APPROVAL',
    });
    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
    ).rejects.toThrow(/not been approved by the business/i);

    await intents.approveForPayment(intent.id, staffId, {});
    const after = await psp.customerPaymentStatus(intent.id, customer.user.id);
    expect(after).toMatchObject({ state: 'NOT_STARTED', canBeginPayment: true, reason: null });
  });

  /**
   * The double-payment guard, seen from the customer's side: once a bill
   * exists the preview says so, the second begin is refused, and the
   * status still points at the first attempt — the one the customer can
   * pick up again rather than being told to start over.
   */
  it('refuses a second begin while the first attempt is live, and says why', async () => {
    const { customer, intent } = await providerPurchase();
    await intents.approveForPayment(intent.id, staffId, {});

    const first = await psp.beginAttempt({
      purchaseIntentId: intent.id,
      customerId: customer.user.id,
    });
    const status = await psp.customerPaymentStatus(intent.id, customer.user.id);
    expect(status).toMatchObject({
      state: 'WAITING_PROVIDER',
      attemptId: first.attemptId,
      canBeginPayment: false,
      reason: 'UNRESOLVED_ATTEMPT',
    });

    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
    ).rejects.toThrow(/unresolved/i);
    expect(await prisma.pspPaymentAttempt.count({ where: { purchaseIntentId: intent.id } })).toBe(1);
  });

  it('names a purchase fully covered by bonus as having nothing to collect', async () => {
    const { customer, intent } = await providerPurchase('1000', '1000');
    await intents.approveForPayment(intent.id, staffId, {});
    const status = await psp.customerPaymentStatus(intent.id, customer.user.id);
    expect(status).toMatchObject({ canBeginPayment: false, reason: 'NOTHING_TO_COLLECT' });
    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
    ).rejects.toThrow(/nothing to collect/i);
  });

  it('names an expired purchase as closed rather than blaming the cashier', async () => {
    const { customer, intent } = await providerPurchase();
    await prisma.purchaseIntent.update({
      where: { id: intent.id },
      data: { status: PurchaseIntentStatus.EXPIRED },
    });
    const status = await psp.customerPaymentStatus(intent.id, customer.user.id);
    expect(status).toMatchObject({
      state: 'NOT_STARTED',
      canBeginPayment: false,
      reason: 'PURCHASE_NOT_OPEN',
      purchaseStatus: PurchaseIntentStatus.EXPIRED,
    });
    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
    ).rejects.toThrow(/Purchase is EXPIRED/);
  });

  it('names a switched-off provider as such, on an otherwise payable purchase', async () => {
    const { customer, intent } = await providerPurchase();
    await intents.approveForPayment(intent.id, staffId, {});

    const realGet = config.get.bind(config);
    const spy = jest
      .spyOn(config, 'get')
      .mockImplementation((key: unknown, ...rest: unknown[]) =>
        key === 'features.tutakPspEnabled'
          ? false
          : (realGet as (...args: unknown[]) => unknown)(key, ...rest),
      );
    try {
      const status = await psp.customerPaymentStatus(intent.id, customer.user.id);
      expect(status).toMatchObject({ canBeginPayment: false, reason: 'PROVIDER_DISABLED' });
      await expect(
        psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
      ).rejects.toThrow(/not available yet/i);
    } finally {
      spy.mockRestore();
    }
  });
});
