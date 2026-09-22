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
 * The flag means "start nothing new", and every step that can *start*
 * money moving — creating a provider-routed purchase, opening a bill, the
 * pre-check that invites the provider to charge — checks it, not just the
 * first one: rows outlive flags (created before it was turned off, restored
 * from a backup, seeded, written by a migration).
 *
 * The flag does **not** mean "account for nothing". Money the provider has
 * already taken is settled whatever the flag says, because an emergency
 * switch-off must never manufacture an unaccounted payment. Both halves are
 * tested below.
 */
describe('Money flags off (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;

  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['TUTAK_PSP_ENABLED', 'IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY', 'IDRAM_FORM_ACTION'] as const) {
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
    staffId = (await createStaffUser(prisma, { partnerId })).id;
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
   * What the flag means, and what it does not.
   *
   * Off means "start nothing new". It does **not** mean "account for
   * nothing": a callback for money the provider has already taken must
   * still be settled, or switching the route off in an emergency *creates*
   * an unaccounted payment — the customer paid, the platform refused to
   * notice, and the row sits in the inbox for ever. That is the scenario
   * this test reproduces end to end:
   *
   *   route ON → bill opened → pre-check passed → route OFF
   *     → verified final callback → exactly one settlement.
   *
   * Two application instances because the flag is read at boot: the first
   * runs with the route on and gets the customer as far as the provider's
   * page; the second boots with it off and receives the callback.
   */
  it('settles a payment that started before the route was switched off', async () => {
    // ── Instance A: route ON, credentials set, bill opened, pre-check passed
    process.env.TUTAK_PSP_ENABLED = 'true';
    process.env.IDRAM_FORM_ACTION = 'https://sandbox.idram.example/pay';
    const on = await createTestHarness();
    const onPsp = on.app.get(PspPaymentService);
    const onIntents = on.app.get(PurchaseIntentsService);
    let intentId = '';
    let billId = '';
    try {
      const customer = await createCustomer(prisma);
      const intent = await onIntents.create(
        { partnerId, grossAmount: '15000', bonusAmountRequested: '0', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      await onIntents.approveForPayment(intent.id, staffId, {});
      const begun = await onPsp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id });
      intentId = intent.id;
      billId = begun.billId;

      const precheck = await onPsp.answerPrecheck({
        EDP_PRECHECK: 'YES',
        EDP_REC_ACCOUNT: '111222333',
        EDP_BILL_NO: billId,
        EDP_AMOUNT: '15000.00',
      });
      expect(precheck.ok).toBe(true);
    } finally {
      await on.close();
    }

    // ── Emergency: route OFF. The customer is on the provider's page.
    delete process.env.TUTAK_PSP_ENABLED;
    delete process.env.IDRAM_FORM_ACTION;
    const off = await createTestHarness();
    try {
      const offPsp = off.app.get(PspPaymentService);
      const worker = off.app.get(
        (await import('../src/modules/psp/psp-callback-worker.service')).PspCallbackWorkerService,
      );

      // New money is refused on this instance…
      const late = await offPsp.answerPrecheck({
        EDP_PRECHECK: 'YES', EDP_REC_ACCOUNT: '111222333', EDP_BILL_NO: billId, EDP_AMOUNT: '15000.00',
      });
      expect(late.ok).toBe(false);

      // …but the payment already taken is accounted for. Written straight to
      // the inbox as verified, which is what the controller does with a
      // genuine callback; the worker is what is under test.
      await prisma.pspCallbackInbox.create({
        data: {
          provider: 'idram',
          kind: 'FINAL',
          status: 'RECEIVED',
          dedupeKey: `idram:FINAL:${billId}:IDRAM-AFTER-OFF`,
          billId,
          providerTransactionId: 'IDRAM-AFTER-OFF',
          reportedAmount: new Decimal('15000'),
          verified: true,
          rawPayload: { EDP_BILL_NO: billId },
          pendingKey: 'pending',
        },
      });

      const drained = await worker.processPending();
      expect(drained.failed).toBe(0);
      expect(drained.processed).toBe(1);

      expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(1);
      expect((await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe(
        PurchaseIntentStatus.CONFIRMED,
      );
      const attempt = await prisma.pspPaymentAttempt.findFirstOrThrow({ where: { providerBillId: billId } });
      expect(attempt.status).toBe(PspAttemptStatus.SUCCEEDED);

      // And a replay of the same callback on the OFF instance is still one payment.
      expect((await worker.processPending()).processed).toBe(0);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(1);
    } finally {
      await off.close();
    }
  });

  /**
   * Item 5 of the review: a misconfigured provider must fail closed *before*
   * an attempt exists. The first version wrote the `INITIATED` row and then
   * asked the adapter, so a missing merchant id left an unsafe, unresolved
   * attempt that blocked the customer from paying again for a payment that
   * had never been offered.
   */
  it('leaves no attempt behind when the provider is not configured', async () => {
    process.env.TUTAK_PSP_ENABLED = 'true';
    delete process.env.IDRAM_FORM_ACTION; // route on, action deliberately missing
    const on = await createTestHarness();
    try {
      const onPsp = on.app.get(PspPaymentService);
      const onIntents = on.app.get(PurchaseIntentsService);
      const customer = await createCustomer(prisma);
      const intent = await onIntents.create(
        { partnerId, grossAmount: '15000', bonusAmountRequested: '0', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      await onIntents.approveForPayment(intent.id, staffId, {});

      await expect(
        onPsp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
      ).rejects.toThrow(/IDRAM_FORM_ACTION/);

      expect(await prisma.pspPaymentAttempt.count()).toBe(0);
      // Fixed by configuration, the same purchase can then be paid — nothing
      // was stranded.
      expect(
        (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
      ).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
    } finally {
      await on.close();
      delete process.env.TUTAK_PSP_ENABLED;
    }
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
