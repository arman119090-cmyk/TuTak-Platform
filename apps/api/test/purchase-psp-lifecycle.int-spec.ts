import {
  BonusEntryType,
  BonusReservationStatus,
  PaymentRoute,
  PrismaClient,
  PspAttemptStatus,
  PspResolutionBasis,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PspAttemptAgeingService } from '../src/modules/psp/psp-attempt-ageing.service';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { CustomerFixture, createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The purchase and the payment are one lifecycle, not two.
 *
 * The product decision of 15.09.2026, and the hole it closes is a clock racing a
 * payment. The generic three-minute expiry predates the provider route
 * entirely, and on a stale purchase it releases the bonus reservation, fails
 * the source transaction and marks the purchase EXPIRED. Every one of those
 * is right for a customer who walked away from a till. None of them is right
 * while Idram may already have taken the money — and the third is the
 * expensive one, because a callback arriving afterwards finds a purchase that
 * is no longer awaiting confirmation and completes nothing. Money in, nothing
 * out.
 *
 * Deliberately no new `PSP_PENDING` status. The purchase's state has not
 * changed: it is still awaiting confirmation, and confirmation still ends it.
 * What changed is who may end it early.
 */
describe('Purchase and PSP lifecycle (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let intents: PurchaseIntentsService;
  let psp: PspPaymentService;
  let ageing: PspAttemptAgeingService;
  let bonusEngine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    intents = harness.app.get(PurchaseIntentsService);
    psp = harness.app.get(PspPaymentService);
    ageing = harness.app.get(PspAttemptAgeingService);
    bonusEngine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';
  let financeA = '';
  let financeB = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma, { partnerId })).id;
    financeA = (await createStaffUser(prisma)).id;
    financeB = (await createStaffUser(prisma)).id;
  });

  /**
   * A provider-routed purchase, approved by staff, with a live bill — the
   * exact state a customer is in while the Idram page is open in front of
   * them.
   */
  async function paying(billId: string, bonus = '1000') {
    const customer = await createCustomer(prisma);
    await bonusEngine.accrue({
      walletId: customer.wallet.id,
      type: BonusEntryType.ACCRUAL_PURCHASE,
      amount: bonus,
      pendingHours: 0,
    });
    const intent = await intents.create(
      {
        partnerId,
        grossAmount: '15000',
        bonusAmountRequested: bonus,
        paymentRoute: PaymentRoute.TUTAK_PSP,
      },
      customer.user.id,
    );
    await intents.approveForPayment(intent.id, staffId, {});
    const attempt = await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: new Decimal('14000'),
        providerBillId: billId,
        liveKey: 'live',
      },
    });
    return { customer, intent, attempt };
  }

  /** Push a purchase past its own three-minute window. */
  async function backdate(intentId: string) {
    await prisma.purchaseIntent.update({
      where: { id: intentId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
  }

  const reservationOf = async (customer: CustomerFixture) =>
    prisma.bonusReservation.findFirstOrThrow({ where: { walletId: customer.wallet.id } });

  const confirmation = (billId: string, txId = 'IDRAM-LATE') => ({
    billId,
    providerTransactionId: txId,
    amount: new Decimal('14000'),
    raw: { EDP_BILL_NO: billId },
  });

  /**
   * The two-person release, as two authenticated acts.
   *
   * Since 15.09.2026 this is deliberately not one call: one caller passing
   * two user ids is one person asserting who the second person was. Tests go
   * through both steps so they exercise the shape production uses.
   */
  async function reconcileWithTwoPeople(
    attemptId: string,
    proposer: string,
    checker: string,
    evidence: string,
  ) {
    await psp.proposeManualReconciliation({ attemptId, actorId: proposer, evidence });
    return psp.confirmManualReconciliation({ attemptId, actorId: checker });
  }

  // ── 1. The expiry sweep ────────────────────────────────────────────────

  it('leaves a paying purchase alone when the expiry sweep runs', async () => {
    const { customer, intent } = await paying('bill-sweep');
    await backdate(intent.id);

    const expired = await intents.expireStale();
    expect(expired).toBe(0);

    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);

    // The economics are untouched: the points are still held and the source
    // transaction has not been declared failed.
    const reservation = await reservationOf(customer);
    expect(reservation.status).toBe(BonusReservationStatus.ACTIVE);
    const sourceTx = await prisma.transaction.findUniqueOrThrow({
      where: { id: after.sourceTransactionId! },
    });
    expect(sourceTx.status).toBe('INITIATED');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    expect(new Decimal(wallet.reservedBonus).toFixed(2)).toBe('1000.00');
    expect(new Decimal(wallet.availableBonus).toFixed(2)).toBe('0.00');
  });

  it('will not release the reservation from the bonus sweep either', async () => {
    const { customer, intent } = await paying('bill-res-sweep');
    await backdate(intent.id);

    // `releaseExpiredReservations` never looks at `purchase_intents`: it
    // reads reservations by their own `expiresAt`. So the purchase-level rule
    // would not have stopped it, and the points would have gone back with the
    // purchase still open — the same loss by a quieter route.
    const reservation = await reservationOf(customer);
    await prisma.bonusReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const released = await bonusEngine.releaseExpiredReservations();
    expect(released).toBe(0);
    expect((await reservationOf(customer)).status).toBe(BonusReservationStatus.ACTIVE);
  });

  it('refuses at the database level to expire a purchase that is being paid', async () => {
    const { intent } = await paying('bill-db-expire');

    await expect(
      prisma.purchaseIntent.update({
        where: { id: intent.id },
        data: { status: PurchaseIntentStatus.EXPIRED },
      }),
    ).rejects.toThrow(/provider may hold the customer/i);
  });

  // ── 1. Cancellation, and the cashier's equivalent ──────────────────────

  it('refuses a customer cancellation while the payment is unresolved', async () => {
    const { customer, intent } = await paying('bill-cancel');

    await expect(intents.cancel(intent.id, customer.user.id)).rejects.toThrow(
      /still being processed/i,
    );
    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
    expect((await reservationOf(customer)).status).toBe(BonusReservationStatus.ACTIVE);
  });

  it('refuses a cashier rejection while the payment is unresolved', async () => {
    const { intent } = await paying('bill-reject');

    await expect(
      intents.reject(intent.id, staffId, { reasonCode: 'changed_mind' }),
    ).rejects.toThrow(/still being processed/i);
  });

  it.each([
    PspAttemptStatus.INITIATED,
    PspAttemptStatus.PENDING_CONFIRMATION,
    PspAttemptStatus.EXPIRED,
    PspAttemptStatus.REQUIRES_RECONCILIATION,
  ])('holds the purchase open while an attempt is %s', async (status) => {
    const { customer, intent, attempt } = await paying(`bill-hold-${status}`);
    if (status !== PspAttemptStatus.INITIATED) {
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data:
          status === PspAttemptStatus.PENDING_CONFIRMATION
            ? { status }
            : { status, liveKey: null, resolvedAt: new Date() },
      });
    }
    await backdate(intent.id);

    expect(await intents.expireStale()).toBe(0);
    await expect(intents.cancel(intent.id, customer.user.id)).rejects.toThrow(
      /still being processed/i,
    );
  });

  // ── 3. The late callback finishes the purchase, exactly once ───────────

  it('completes the purchase on a callback that arrives after the timeout', async () => {
    const { customer, intent } = await paying('bill-late');
    await backdate(intent.id);
    // The sweep runs and correctly does nothing.
    await intents.expireStale();

    const result = await psp.settleVerifiedConfirmation(confirmation('bill-late'));
    expect(result.alreadySettled).toBe(false);

    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.CONFIRMED);
    expect((await reservationOf(customer)).status).toBe(BonusReservationStatus.SETTLED);
    const sourceTx = await prisma.transaction.findUniqueOrThrow({
      where: { id: after.sourceTransactionId! },
    });
    expect(sourceTx.status).toBe('COMPLETED');
  });

  it('completes it exactly once however many callbacks arrive', async () => {
    const { intent } = await paying('bill-late-many');
    await backdate(intent.id);
    await intents.expireStale();

    // Ten deliveries, one after another, which is what a provider retrying
    // actually looks like. The concurrent burst is a different question and
    // is tested separately — see the note there about the connection pool.
    for (let i = 0; i < 10; i += 1) {
      const result = await psp.settleVerifiedConfirmation(confirmation('bill-late-many'));
      expect(result.alreadySettled).toBe(i > 0);
    }

    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(
      1,
    );
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(
      1,
    );
    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.CONFIRMED);
  });

  // ── 4. An authoritative "no" releases everything, once ─────────────────

  it('lets the purchase expire normally once the provider says it failed', async () => {
    const { customer, intent, attempt } = await paying('bill-auth-no');
    await backdate(intent.id);
    expect(await intents.expireStale()).toBe(0);

    await prisma.pspPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PspAttemptStatus.FAILED,
        resolutionBasis: PspResolutionBasis.PROVIDER_CALLBACK,
        failureReason: 'Declined by issuer',
        liveKey: null,
        resolvedAt: new Date(),
      },
    });

    expect(await intents.expireStale()).toBe(1);
    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.EXPIRED);

    const reservation = await reservationOf(customer);
    expect(reservation.status).toBe(BonusReservationStatus.RELEASED);
    // Exactly once: the points are back, not back twice.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    expect(new Decimal(wallet.availableBonus).toFixed(2)).toBe('1000.00');
    expect(new Decimal(wallet.reservedBonus).toFixed(2)).toBe('0.00');

    // And a second sweep does not release anything a second time.
    expect(await intents.expireStale()).toBe(0);
    const again = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    expect(new Decimal(again.availableBonus).toFixed(2)).toBe('1000.00');
  });

  it('lets the customer cancel once two people have reconciled it to no', async () => {
    const { customer, intent, attempt } = await paying('bill-manual-no');

    await prisma.pspPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
    });
    await expect(intents.cancel(intent.id, customer.user.id)).rejects.toThrow(
      /still being processed/i,
    );

    await reconcileWithTwoPeople(
      attempt.id,
      financeA,
      financeB,
      'Idram portal shows no transaction for bill-manual-no',
    );

    const cancelled = await intents.cancel(intent.id, customer.user.id);
    expect(cancelled.status).toBe(PurchaseIntentStatus.CANCELLED);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    expect(new Decimal(wallet.availableBonus).toFixed(2)).toBe('1000.00');
    expect(new Decimal(wallet.reservedBonus).toFixed(2)).toBe('0.00');
  });

  it('lets the customer start a fresh purchase afterwards', async () => {
    const { customer, intent, attempt } = await paying('bill-retry');
    await prisma.pspPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PspAttemptStatus.FAILED,
        resolutionBasis: PspResolutionBasis.PROVIDER_CALLBACK,
        liveKey: null,
        resolvedAt: new Date(),
      },
    });
    await intents.cancel(intent.id, customer.user.id);

    await expect(
      intents.create({ partnerId, grossAmount: '15000' }, customer.user.id),
    ).resolves.toBeDefined();
  });

  // ── 2. A late callback on an attempt the platform gave up on ───────────

  describe('a callback after the attempt timed out', () => {
    it('confirms it, because EXPIRED means we stopped waiting, not that they stopped paying', async () => {
      const { intent, attempt } = await paying('bill-expired-late');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });

      const result = await psp.settleVerifiedConfirmation(confirmation('bill-expired-late'));
      expect(result.alreadySettled).toBe(false);

      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.status).toBe(PspAttemptStatus.SUCCEEDED);
      expect(after.resolutionBasis).toBe(PspResolutionBasis.PROVIDER_CALLBACK);
      expect(
        (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
      ).toBe(PurchaseIntentStatus.CONFIRMED);
    });

    it('confirms it once, however many times the provider retries', async () => {
      const { attempt } = await paying('bill-expired-ten');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });

      for (let i = 0; i < 10; i += 1) {
        const result = await psp.settleVerifiedConfirmation(confirmation('bill-expired-ten'));
        expect(result.alreadySettled).toBe(i > 0);
      }

      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
      ).toBe(1);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } }),
      ).toBe(1);
      expect(
        await prisma.ledgerTransaction.count({
          where: { kind: 'partner.bonus_redemption_compensation' },
        }),
      ).toBe(1);
    });

    /**
     * The same question asked concurrently, and at a width the connection
     * pool can actually serve.
     *
     * Ten at once does **not** work, and the reason is worth writing down
     * because it looks like a correctness bug and is not: Prisma's pool is
     * five connections, each settlement holds one for a whole transaction,
     * and the surplus callers fail with "Unable to start a transaction in the
     * given time" before touching a row. Nothing is double-counted — nothing
     * happens at all — but the provider sees errors and retries, which is a
     * robustness problem rather than an accounting one. Recorded in the
     * report rather than papered over here.
     */
    it('confirms it once when several callbacks land together', async () => {
      const { attempt } = await paying('bill-expired-burst');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });

      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          psp.settleVerifiedConfirmation(confirmation('bill-expired-burst')),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);

      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
      ).toBe(1);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } }),
      ).toBe(1);
      expect(
        (await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
      ).toBe(PspAttemptStatus.SUCCEEDED);
    });

    it('will not confirm one that two people already reconciled to no', async () => {
      const { attempt } = await paying('bill-manual-wins');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });
      await reconcileWithTwoPeople(
        attempt.id,
        financeA,
        financeB,
        'No transaction on the provider portal',
      );

      // An answer outranks a later callback. Refusing is what stops the
      // purchase being accounted for twice — once by the people who released
      // it and once by the provider.
      await expect(
        psp.settleVerifiedConfirmation(confirmation('bill-manual-wins')),
      ).rejects.toThrow(/resolved concurrently/i);

      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
      ).toBe(0);
      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.status).toBe(PspAttemptStatus.FAILED);
      expect(after.resolutionBasis).toBe(PspResolutionBasis.MANUAL_RECONCILIATION);
    });

    it('produces exactly one winner when the callback and the reconciliation race', async () => {
      const { attempt } = await paying('bill-race');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });

      const [callback, manual] = await Promise.allSettled([
        psp.settleVerifiedConfirmation(confirmation('bill-race')),
        reconcileWithTwoPeople(attempt.id, financeA, financeB, 'Nothing on the portal'),
      ]);

      const winners = [callback, manual].filter((r) => r.status === 'fulfilled');
      expect(winners).toHaveLength(1);

      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      const captures = await prisma.ledgerTransaction.count({
        where: { kind: 'psp.payment.captured' },
      });

      // Whichever won, the books agree with the row: money captured exactly
      // when the attempt says it succeeded, and never otherwise.
      if (after.status === PspAttemptStatus.SUCCEEDED) {
        expect(captures).toBe(1);
        expect(after.resolutionBasis).toBe(PspResolutionBasis.PROVIDER_CALLBACK);
      } else {
        expect(after.status).toBe(PspAttemptStatus.FAILED);
        expect(captures).toBe(0);
        expect(after.resolutionBasis).toBe(PspResolutionBasis.MANUAL_RECONCILIATION);
      }
    });

    it('still refuses one the provider itself declined', async () => {
      const { attempt } = await paying('bill-declined');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: PspAttemptStatus.FAILED,
          resolutionBasis: PspResolutionBasis.PROVIDER_CALLBACK,
          failureReason: 'Declined by issuer',
          liveKey: null,
          resolvedAt: new Date(),
        },
      });

      await expect(psp.settleVerifiedConfirmation(confirmation('bill-declined'))).rejects.toThrow(
        /resolved concurrently/i,
      );
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
      ).toBe(0);
    });

    it('holds a late callback whose amount disagrees, rather than settling it', async () => {
      const { attempt } = await paying('bill-late-mismatch');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });

      await expect(
        psp.settleVerifiedConfirmation({
          billId: 'bill-late-mismatch',
          providerTransactionId: 'IDRAM-ODD',
          amount: new Decimal('9000'),
          raw: {},
        }),
      ).rejects.toThrow(/mismatch/i);

      const after = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(after.status).toBe(PspAttemptStatus.REQUIRES_RECONCILIATION);
    });
  });

  // ── Ageing still escalates a held-open purchase ────────────────────────

  it('escalates a purchase held open by an unresolved payment', async () => {
    const { intent, attempt } = await paying('bill-escalate');
    await backdate(intent.id);
    await prisma.$executeRawUnsafe(
      'UPDATE "psp_payment_attempts" SET "createdAt" = $1 WHERE "id" = $2',
      new Date(Date.now() - 90 * 60_000),
      attempt.id,
    );

    const result = await ageing.escalateStaleAttempts();
    expect(result.expired).toBe(1);
    expect(result.escalated).toBeGreaterThanOrEqual(1);
    expect(harness.alerts.matching('psp.attempt-unresolved').length).toBeGreaterThanOrEqual(1);

    // Escalating is not resolving: the purchase is still open and still
    // holding the customer's points.
    expect(
      (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
    ).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
    expect(await intents.expireStale()).toBe(0);
  });

  // ── Direct purchases are untouched by any of this ──────────────────────

  it('expires an ordinary direct purchase exactly as before', async () => {
    const customer = await createCustomer(prisma);
    const intent = await intents.create({ partnerId, grossAmount: '5000' }, customer.user.id);
    await backdate(intent.id);

    expect(await intents.expireStale()).toBe(1);
    expect(
      (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
    ).toBe(PurchaseIntentStatus.EXPIRED);
  });

  it('lets a customer cancel an ordinary direct purchase exactly as before', async () => {
    const customer = await createCustomer(prisma);
    await bonusEngine.accrue({
      walletId: customer.wallet.id,
      type: BonusEntryType.ACCRUAL_PURCHASE,
      amount: '500',
      pendingHours: 0,
    });
    const intent = await intents.create(
      { partnerId, grossAmount: '5000', bonusAmountRequested: '500' },
      customer.user.id,
    );

    const cancelled = await intents.cancel(intent.id, customer.user.id);
    expect(cancelled.status).toBe(PurchaseIntentStatus.CANCELLED);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
    expect(new Decimal(wallet.availableBonus).toFixed(2)).toBe('500.00');
  });

  // ── Merchant authorisation ─────────────────────────────────────────────

  describe('merchant authorisation', () => {
    it('refuses to open a bill on a purchase nobody at the business approved', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );

      await expect(
        psp.beginAttempt({ purchaseIntentId: intent.id, customerId: customer.user.id }),
      ).rejects.toThrow(/not been approved by the business/i);
    });

    it('refuses at the database level too', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );

      await expect(
        prisma.pspPaymentAttempt.create({
          data: {
            purchaseIntentId: intent.id,
            provider: 'idram',
            status: PspAttemptStatus.INITIATED,
            amount: new Decimal('15000'),
            providerBillId: 'bill-unapproved',
            liveKey: 'live',
          },
        }),
      ).rejects.toThrow(/not been approved by the merchant/i);
    });

    it('freezes the economics once approved', async () => {
      const { intent } = await paying('bill-frozen');

      await expect(
        prisma.purchaseIntent.update({
          where: { id: intent.id },
          data: { grossAmount: new Decimal('999999') },
        }),
      ).rejects.toThrow(/economics are frozen/i);
    });

    it('makes a merchant approval idempotent', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      const first = await intents.approveForPayment(intent.id, staffId, {});
      const second = await intents.approveForPayment(intent.id, financeA, {});

      expect(second.merchantApprovedAt).toEqual(first.merchantApprovedAt);
      expect(second.merchantApprovedByUserId).toBe(staffId);
    });

    it('will not approve a direct purchase for payment — confirming it is the approval', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create({ partnerId, grossAmount: '5000' }, customer.user.id);

      await expect(intents.approveForPayment(intent.id, staffId, {})).rejects.toThrow(
        /paid at the till/i,
      );
    });

    it('stamps the approval when a cashier confirms a direct purchase', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create({ partnerId, grossAmount: '5000' }, customer.user.id);

      const confirmed = await intents.confirm(intent.id, staffId);
      expect(confirmed.merchantApprovedByUserId).toBe(staffId);
      expect(confirmed.merchantApprovedAt).not.toBeNull();
    });
  });
});
