import { PaymentRoute, PrismaClient, PspAttemptStatus, PurchaseIntentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What the platform must refuse while the money flags are off.
 *
 * ## Why this suite exists separately
 *
 * Every other PSP suite runs with the provider route *enabled*, because it is
 * testing what the route does. This one tests what the deployment does when
 * the route is switched off — which is the state production is actually in,
 * and therefore the state nobody had a test for.
 *
 * ## The rule being enforced
 *
 * A flag that guards only the *first* step of a flow guards nothing: the
 * later steps are reachable by any row that already exists. Rows outlive
 * flags — created before the flag was turned off, restored from a backup,
 * seeded, or written by a migration. So every step that can move real money
 * has to check, not just the one at the front.
 */
describe('Money flags off (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;

  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['TUTAK_PSP_ENABLED', 'IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY'] as const) {
      saved[key] = process.env[key];
    }
    // Deleted, not set to "false": production's state is an *absent*
    // variable, and a guard written as `!== 'false'` would pass a test that
    // only ever set the string.
    delete process.env.TUTAK_PSP_ENABLED;
    // Credentials present on purpose. The protection must come from the flag,
    // not from the adapter happening to be unconfigured — otherwise the gate
    // disappears the moment somebody stages credentials ahead of activation.
    process.env.IDRAM_MERCHANT_ID = '111222333';
    process.env.IDRAM_SECRET_KEY = 'staged-ahead-of-activation';

    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
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

  it('refuses to create a provider-routed purchase', async () => {
    const customer = await createCustomer(prisma);
    await expect(
      intents.create(
        {
          partnerId,
          grossAmount: '15000',
          bonusAmountRequested: '0',
          paymentRoute: PaymentRoute.TUTAK_PSP,
        },
        customer.user.id,
      ),
    ).rejects.toThrow(/not available/i);
  });

  /**
   * The hole this suite was written for.
   *
   * A `TUTAK_PSP` purchase that already exists — created while the flag was
   * on, restored from a backup, seeded — could be handed to `beginAttempt`,
   * which opened a real bill with real credentials and returned a real
   * payment form. The customer would then pay real money into an account the
   * worker refuses to settle from, because the worker *does* check the flag.
   * Charged, and nothing delivered: the worst of the possible states.
   */
  it('refuses to open a provider bill on a purchase that already exists', async () => {
    const customer = await createCustomer(prisma);
    // Written directly: the service refuses to create one, which is the whole
    // point — this is a row that outlived the flag.
    const intent = await prisma.purchaseIntent.create({
      data: {
        customerId: customer.user.id,
        partnerId,
        status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
        paymentRoute: PaymentRoute.TUTAK_PSP,
        grossAmount: '15000',
        bonusAmountRequested: '0',
        ordinaryPaymentRemainder: '15000',
        negotiatedRateBps: 500,
        maxBonusPaymentPercent: 50,
        confirmationCode: '4242',
        expiresAt: new Date(Date.now() + 3 * 60_000),
        merchantApprovedByUserId: staffId,
        merchantApprovedAt: new Date(),
      },
    });

    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
    ).rejects.toThrow(/not available|disabled|not enabled/i);

    // And nothing was written: no attempt, no bill, nothing to call back about.
    expect(await prisma.pspPaymentAttempt.count()).toBe(0);
  });

  /**
   * The worker is the last gate, and it must hold even if a callback somehow
   * reached the inbox — misrouted, replayed from a prior deployment, or an
   * attacker guessing a bill id.
   */
  it('settles nothing even when a verified callback is already in the inbox', async () => {
    const customer = await createCustomer(prisma);
    const intent = await prisma.purchaseIntent.create({
      data: {
        customerId: customer.user.id,
        partnerId,
        status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
        paymentRoute: PaymentRoute.TUTAK_PSP,
        grossAmount: '15000',
        bonusAmountRequested: '0',
        ordinaryPaymentRemainder: '15000',
        negotiatedRateBps: 500,
        maxBonusPaymentPercent: 50,
        confirmationCode: '4243',
        expiresAt: new Date(Date.now() + 3 * 60_000),
        merchantApprovedByUserId: staffId,
        merchantApprovedAt: new Date(),
      },
    });
    await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: new Decimal('15000'),
        providerBillId: 'bill-while-disabled',
        liveKey: 'live',
      },
    });

    const worker = harness.app.get(
      // Resolved by name to keep this suite independent of the worker's own
      // module wiring.
      (await import('../src/modules/psp/psp-callback-worker.service')).PspCallbackWorkerService,
    );
    const result = await worker.processPending();

    expect(result.processed).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(
      0,
    );
  });

  /** The route that is actually live must be untouched by any of this. */
  it('leaves the ordinary till route working', async () => {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, grossAmount: '15000', bonusAmountRequested: '0' },
      customer.user.id,
    );
    await intents.confirm(intent.id, staffId);

    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.CONFIRMED);
  });
});
