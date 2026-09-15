import {
  BonusEntryType,
  LedgerAccountType,
  PaymentRoute,
  PostingDirection,
  PrismaClient,
  PspAttemptStatus,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { CustomerFixture, createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * One purchase, one money route — the invariant the whole hybrid model rests
 * on, tested where it is actually enforced.
 *
 * The scenario worth spelling out: a customer starts paying through the
 * provider, the callback is slow, and the cashier is asked to "just take
 * cash". If that works, the callback lands later and the customer has paid
 * twice for one coffee. Everything below is a different route to that
 * failure, and every one of them has to be closed.
 */
describe('PSP payment route (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;
  let bonusEngine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
    bonusEngine = harness.app.get(BonusEngineService);
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

  /**
   * A purchase on the given route, created through the real service.
   *
   * It used to be a bare `prisma.purchaseIntent.create`, on the reasoning
   * that this suite is about routing rather than about purchase creation.
   * That reasoning stopped holding the moment a provider confirmation began
   * finalising the purchase: a hand-written row has no source transaction, no
   * bonus reservation and no referral chain, so it exercised a settlement
   * path that cannot occur in production and would have hidden whatever that
   * path gets wrong. The whole point of finding 1 is that the two halves are
   * one transaction, so the fixture has to be a real purchase.
   */
  async function purchase(route: PaymentRoute, gross = '15000', bonus = '1000') {
    const customer = await createCustomer(prisma);
    if (new Decimal(bonus).greaterThan(0)) {
      await grantBonus(customer, bonus);
    }
    return intents.create(
      { partnerId, grossAmount: gross, bonusAmountRequested: bonus, paymentRoute: route },
      customer.user.id,
    );
  }

  /**
   * Available bonus the customer can actually spend.
   *
   * Through the engine, not by writing `Wallet.availableBonus`: the balance
   * columns are a projection of the lots, and a wallet whose number says
   * 1,000 with no lot behind it cannot reserve anything — `reserve()` reads
   * the lots.
   */
  async function grantBonus(customer: CustomerFixture, amount: string) {
    await bonusEngine.accrue({
      walletId: customer.wallet.id,
      type: BonusEntryType.ACCRUAL_PURCHASE,
      amount,
      pendingHours: 0,
    });
  }

  async function attemptFor(intentId: string, billId: string) {
    return prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intentId,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: new Decimal('14000'),
        providerBillId: billId,
        liveKey: 'live',
      },
    });
  }

  const confirmation = (billId: string, txId = 'IDRAM-1', amount = '14000') => ({
    billId,
    providerTransactionId: txId,
    amount: new Decimal(amount),
    raw: { EDP_BILL_NO: billId },
  });

  it('refuses a cashier confirmation on a provider-routed purchase', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    await attemptFor(intent.id, 'bill-1');

    await expect(intents.confirm(intent.id, staffId)).rejects.toThrow(
      /payment provider.*must not be\s+collected at the till/is,
    );

    // And nothing was settled behind the refusal.
    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
  });

  it('will not let a provider attempt exist on a direct purchase, at the database level', async () => {
    const intent = await purchase(PaymentRoute.DIRECT_PARTNER);

    await expect(attemptFor(intent.id, 'bill-2')).rejects.toThrow(/not TUTAK_PSP/i);
  });

  it('allows only one live attempt per purchase', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    await attemptFor(intent.id, 'bill-3');

    // A second tap on "pay" must not open a second bill.
    await expect(attemptFor(intent.id, 'bill-4')).rejects.toThrow();
  });

  it('settles a verified confirmation into the ledger exactly once', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    await attemptFor(intent.id, 'bill-5');

    const first = await psp.settleVerifiedConfirmation(confirmation('bill-5'));
    expect(first.alreadySettled).toBe(false);

    // Ten deliveries of the same callback, the effect of one.
    for (let i = 0; i < 9; i += 1) {
      const again = await psp.settleVerifiedConfirmation(confirmation('bill-5'));
      expect(again.alreadySettled).toBe(true);
    }

    const posted = await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } });
    expect(posted).toBe(1);
  });

  it('credits the partner and debits the acquirer claim, and nothing else', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    await attemptFor(intent.id, 'bill-6');
    await psp.settleVerifiedConfirmation(confirmation('bill-6'));

    const postings = await prisma.ledgerPosting.findMany({
      where: { transaction: { kind: 'psp.payment.captured' } },
      include: { account: { select: { type: true, partnerId: true } } },
    });
    expect(postings).toHaveLength(2);

    const payable = postings.find((p) => p.account.type === LedgerAccountType.PARTNER_PAYABLE);
    const receivable = postings.find((p) => p.account.type === LedgerAccountType.PSP_RECEIVABLE);
    expect(payable?.direction).toBe(PostingDirection.CREDIT);
    expect(payable?.account.partnerId).toBe(partnerId);
    expect(new Decimal(payable!.amount).toFixed(2)).toBe('14000.00');
    expect(receivable?.direction).toBe(PostingDirection.DEBIT);
    expect(new Decimal(receivable!.amount).toFixed(2)).toBe('14000.00');
  });

  it('holds a confirmation whose amount disagrees, rather than settling it', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    await attemptFor(intent.id, 'bill-7');

    await expect(
      psp.settleVerifiedConfirmation(confirmation('bill-7', 'IDRAM-X', '9000')),
    ).rejects.toThrow(/mismatch/i);

    const held = await prisma.pspPaymentAttempt.findFirstOrThrow({
      where: { providerBillId: 'bill-7' },
    });
    expect(held.status).toBe(PspAttemptStatus.REQUIRES_RECONCILIATION);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(0);
  });

  it('refuses a confirmation for a bill it never opened', async () => {
    await expect(psp.settleVerifiedConfirmation(confirmation('never-issued'))).rejects.toThrow(
      /unknown bill/i,
    );
  });

  it('keeps a succeeded attempt immutable', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    const attempt = await attemptFor(intent.id, 'bill-8');
    await psp.settleVerifiedConfirmation(confirmation('bill-8'));

    await expect(
      prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { amount: new Decimal(1) },
      }),
    ).rejects.toThrow(/succeeded and cannot be changed/i);
  });

  it('treats a timed-out attempt as unsafe, not as a failure', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    const attempt = await attemptFor(intent.id, 'bill-9');
    await prisma.pspPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
    });

    // Nothing authoritative said the money did not move, so the purchase is
    // still not safe to collect by another route.
    expect(await psp.hasUnsafeAttempt(intent.id)).toBe(true);
  });

  it('treats an explicit provider failure as safe', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    const attempt = await attemptFor(intent.id, 'bill-10');
    await prisma.pspPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: PspAttemptStatus.FAILED, liveKey: null, resolvedAt: new Date() },
    });

    expect(await psp.hasUnsafeAttempt(intent.id)).toBe(false);
  });
  /**
   * Finding 1 of Arman's review of 15.09.2026: a verified provider
   * confirmation must finalise the *purchase*, not merely record that a bill
   * was paid. Before this, the two halves were separate — the ledger learned
   * the money had arrived while the purchase sat in `AWAITING_CONFIRMATION`
   * for ever, earning the customer no cashback and owing the partner nothing.
   *
   * The brief's own worked example, verbatim:
   *
   * > HAZE: 300 AMD/л клиенту, 290 AMD/л экономически партнёру, 10 AMD/л
   * > доля TuTak. 50 L: gross = 15,000, partner entitlement = 14,500,
   * > TuTak contractual share = 500. PSP + 1,000 bonus: TuTak получил
   * > 14,000, партнёр получил напрямую 0, entitlement 14,500 → Net Position
   * > +14,500.
   *
   * ## HAZE's own rate cannot be configured in this platform
   *
   * This is not a rounding slip and it is not fixable in a test. TuTak's
   * share of HAZE is 10 of 300 — one thirtieth, 333.33 basis points — and
   * `partners_commission_rate_on_grid`, live since 16.08.2026, requires:
   *
   *     bonusAccrualRateBps BETWEEN 50 AND 2000 AND bonusAccrualRateBps % 50 = 0
   *
   * 333.33 is not an integer, and 333 is not on the 50-point grid. The two
   * nearest rates that exist are 300 bps (share 450, partner owed 14,550) and
   * 350 bps (share 525, partner owed 14,475). **The brief's 14,500 is not
   * reachable at any configurable rate.**
   *
   * So this test proves the two things it honestly can, and escalates the
   * third rather than dressing it up:
   *
   *  1. the *structure* — after a provider confirmation the partner is owed
   *     their whole entitlement, `gross − TuTak's share`, because they
   *     received nothing at the pump. Asserted exactly.
   *  2. the *arithmetic*, at 350 bps, the closest rate HAZE could actually be
   *     signed on: 14,475.00.
   *  3. that a per-litre margin does not fit a basis-point grid at all. The
   *     platform already has the per-unit shape elsewhere
   *     (`Partner.evWholesaleRatePerKwh`); whether fuel partners move to it,
   *     or the grid is loosened, is a commercial decision and Arman's, not
   *     something to paper over by picking friendlier numbers here.
   */
  it('finalises the purchase and owes the partner their whole entitlement (HAZE, 50 L)', async () => {
    // 300 AMD/л × 50 L = 15,000. 350 bps is the nearest rate the grid allows
    // to HAZE's intended 333.33 — see above for why the brief's own figure
    // is unreachable.
    const rateBps = 350;
    await prisma.partner.update({
      where: { id: partnerId },
      data: { bonusAccrualRateBps: rateBps },
    });

    const gross = new Decimal('15000');
    const bonus = new Decimal('1000');
    const tutakShare = gross.times(rateBps).dividedBy(10_000); // 525.00
    const entitlement = gross.minus(tutakShare); // 14,475.00

    const intent = await purchase(PaymentRoute.TUTAK_PSP, gross.toString(), bonus.toString());
    expect(new Decimal(intent.ordinaryPaymentRemainder).toFixed(2)).toBe('14000.00');

    await attemptFor(intent.id, 'bill-haze');
    await psp.settleVerifiedConfirmation(confirmation('bill-haze', 'IDRAM-HAZE', '14000'));

    // The purchase is finished, not merely paid for.
    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.CONFIRMED);
    // Nobody at a till confirmed it: the provider did, and the column says so
    // rather than naming a cashier who was not there.
    expect(after.confirmedByUserId).toBeNull();
    expect(new Decimal(after.poolAmount!).toFixed(2)).toBe('525.00');

    // (1) and (2): the partner received nothing at the pump, so TuTak owes
    // them the lot — and the lot is exactly gross minus TuTak's share.
    expect((await partnerPayable()).toFixed(2)).toBe(entitlement.toFixed(2));
    expect((await partnerPayable()).toFixed(2)).toBe('14475.00');

    // The three postings that make it up, each on its own account, so a
    // future change that shuffles money between them cannot pass by accident.
    // Note that the customer's 1,000 of bonus reaches the partner as real
    // money too: TuTak compensates the redemption out of BONUS_LIABILITY.
    const byKind = await postingsByKind(LedgerAccountType.PARTNER_PAYABLE);
    expect(byKind.get('psp.payment.captured')?.toFixed(2)).toBe('14000.00');
    expect(byKind.get('partner.bonus_redemption_compensation')?.toFixed(2)).toBe('1000.00');
    expect(byKind.get('partner.contribution')?.toFixed(2)).toBe('-525.00');

    // The customer's side of the same event: the 1,000 of bonus was actually
    // spent, not merely reserved.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: intent.customerId } });
    expect(new Decimal(wallet.reservedBonus).toFixed(2)).toBe('0.00');

    // The source transaction was completed in the same breath. A provider
    // confirmation that leaves it PENDING is the bug this test exists for.
    const sourceTx = await prisma.transaction.findUniqueOrThrow({
      where: { id: intent.sourceTransactionId! },
    });
    expect(sourceTx.status).toBe('COMPLETED');
  });

  it('owes the partner the same entitlement whichever route collected the money', async () => {
    await prisma.partner.update({ where: { id: partnerId }, data: { bonusAccrualRateBps: 350 } });

    // DIRECT: the partner took 14,000 at the till themselves, so TuTak owes
    // them only the bonus compensation less its own share — +475.
    const direct = await purchase(PaymentRoute.DIRECT_PARTNER, '15000', '1000');
    await intents.confirm(direct.id, staffId);
    expect((await partnerPayable()).toFixed(2)).toBe('475.00');

    // PSP: the same purchase, the same entitlement of 14,475, except TuTak
    // holds the 14,000 — so the payable carries the whole 14,475.
    const viaPsp = await purchase(PaymentRoute.TUTAK_PSP, '15000', '1000');
    await attemptFor(viaPsp.id, 'bill-both');
    await psp.settleVerifiedConfirmation(confirmation('bill-both', 'IDRAM-BOTH', '14000'));
    expect((await partnerPayable()).toFixed(2)).toBe(new Decimal('475').plus('14475').toFixed(2));
  });

  it('settles the purchase exactly once no matter how often the callback is delivered', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    await attemptFor(intent.id, 'bill-once');

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        psp.settleVerifiedConfirmation(confirmation('bill-once', 'IDRAM-ONCE', '14000')),
      ),
    );

    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(1);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'partner.bonus_redemption_compensation' } }),
    ).toBe(1);
  });

  /**
   * Finding 2: an amount mismatch parks the attempt in
   * `REQUIRES_RECONCILIATION` and clears `liveKey`. The unique index on
   * `(purchaseIntentId, liveKey)` therefore no longer blocks anything — and
   * the money's fate is still unknown. Handing the customer a fresh bill here
   * is handing them a second charge.
   */
  it('refuses a second attempt while the first is unresolved, liveKey or no liveKey', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    const attempt = await attemptFor(intent.id, 'bill-mismatch');

    await expect(
      psp.settleVerifiedConfirmation(confirmation('bill-mismatch', 'IDRAM-M', '9000')),
    ).rejects.toThrow(/mismatch/i);

    const held = await prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(held.status).toBe(PspAttemptStatus.REQUIRES_RECONCILIATION);
    // The index is genuinely not protecting anything any more.
    expect(held.liveKey).toBeNull();

    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: intent.customerId }),
    ).rejects.toThrow(/unresolved/i);
  });

  /**
   * Every unsafe status, one test each, each reached the way the code
   * actually reaches it. Writing the status in by hand would prove nothing —
   * the database refuses several of these combinations outright, which is
   * itself part of the guarantee.
   */
  const unsafeStates: Array<[PspAttemptStatus, (intentId: string, billId: string) => Promise<void>]> = [
    // Still live: the bill is open and the customer may be paying right now.
    [PspAttemptStatus.INITIATED, async (intentId, billId) => { await attemptFor(intentId, billId); }],
    [
      PspAttemptStatus.PENDING_CONFIRMATION,
      async (intentId, billId) => {
        const a = await attemptFor(intentId, billId);
        await prisma.pspPaymentAttempt.update({
          where: { id: a.id },
          data: { status: PspAttemptStatus.PENDING_CONFIRMATION },
        });
      },
    ],
    // Resolved, but not into an answer.
    [
      PspAttemptStatus.EXPIRED,
      async (intentId, billId) => {
        const a = await attemptFor(intentId, billId);
        await prisma.pspPaymentAttempt.update({
          where: { id: a.id },
          data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
        });
      },
    ],
    [
      PspAttemptStatus.REQUIRES_RECONCILIATION,
      async (intentId, billId) => {
        await attemptFor(intentId, billId);
        // Through the real path: a confirmation whose amount disagrees.
        await psp
          .settleVerifiedConfirmation(confirmation(billId, `IDRAM-${billId}`, '9000'))
          .catch(() => undefined);
      },
    ],
    // Paid. A second bill here is a second charge, plainly.
    [
      PspAttemptStatus.SUCCEEDED,
      async (intentId, billId) => {
        await attemptFor(intentId, billId);
        await psp.settleVerifiedConfirmation(confirmation(billId, `IDRAM-${billId}`, '14000'));
      },
    ],
  ];

  it.each(unsafeStates)('refuses a new attempt while an earlier one is %s', async (status, reach) => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    await reach(intent.id, `bill-${status}`);

    expect(
      (await prisma.pspPaymentAttempt.findFirstOrThrow({ where: { purchaseIntentId: intent.id } }))
        .status,
    ).toBe(status);
    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: intent.customerId }),
    ).rejects.toThrow(status === PspAttemptStatus.SUCCEEDED ? /is CONFIRMED|unresolved/ : /unresolved/i);
  });

  it('allows a new attempt once the provider has said, authoritatively, that it failed', async () => {
    const intent = await purchase(PaymentRoute.TUTAK_PSP);
    const attempt = await attemptFor(intent.id, 'bill-failed');
    await prisma.pspPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: PspAttemptStatus.FAILED, liveKey: null, resolvedAt: new Date() },
    });

    // No provider credentials in the test environment, so the adapter refuses
    // at the point of opening a bill — *after* the safety check this test is
    // about. Reaching that refusal is the assertion: a different error here
    // would mean the unresolved-attempt guard fired when it should not have.
    await expect(
      psp.beginAttempt({ purchaseIntentId: intent.id, customerId: intent.customerId }),
    ).rejects.toThrow(/IDRAM_MERCHANT_ID/);
  });

  /**
   * Finding 4: the cross-purchase double payment.
   *
   * Nothing goes wrong *within* either purchase — each settles exactly once,
   * correctly — and the customer still pays for one meal twice. The only
   * moment it can be stopped is before the second purchase exists.
   */
  describe('cross-purchase double payment', () => {
    it('refuses a new purchase at a business where a provider attempt is unresolved', async () => {
      const customer = await createCustomer(prisma);
      const first = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      const attempt = await attemptFor(first.id, 'bill-cross-1');

      // The attempt times out and the purchase is swept away with it. Neither
      // says the money did not move.
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.EXPIRED, liveKey: null, resolvedAt: new Date() },
      });
      await prisma.purchaseIntent.update({
        where: { id: first.id },
        data: { status: PurchaseIntentStatus.EXPIRED },
      });

      // "Just pay the cashier in cash" — the step that costs the customer.
      await expect(
        intents.create({ partnerId, grossAmount: '15000' }, customer.user.id),
      ).rejects.toThrow(/has not finished/i);
    });

    it('lets the same customer buy elsewhere, and lets others buy here', async () => {
      const customer = await createCustomer(prisma);
      const blocked = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      await attemptFor(blocked.id, 'bill-cross-2');

      const elsewhere = await createPartner(prisma, { displayName: 'Another Business' });
      await expect(
        intents.create({ partnerId: elsewhere.id, grossAmount: '5000' }, customer.user.id),
      ).resolves.toBeDefined();

      const somebodyElse = await createCustomer(prisma);
      await expect(
        intents.create({ partnerId, grossAmount: '5000' }, somebodyElse.user.id),
      ).resolves.toBeDefined();
    });

    it('lets the customer buy again once the provider says the attempt failed', async () => {
      const customer = await createCustomer(prisma);
      const first = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      const attempt = await attemptFor(first.id, 'bill-cross-3');
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PspAttemptStatus.FAILED, liveKey: null, resolvedAt: new Date() },
      });
      await prisma.purchaseIntent.update({
        where: { id: first.id },
        data: { status: PurchaseIntentStatus.EXPIRED },
      });

      await expect(
        intents.create({ partnerId, grossAmount: '15000' }, customer.user.id),
      ).resolves.toBeDefined();
    });

    it('lets only one of two racing in-TuTak checkouts exist, at the database level', async () => {
      const customer = await createCustomer(prisma);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          intents.create(
            { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
            customer.user.id,
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const live = await prisma.purchaseIntent.count({
        where: {
          customerId: customer.user.id,
          partnerId,
          paymentRoute: PaymentRoute.TUTAK_PSP,
          status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
        },
      });
      expect(live).toBe(1);
    });
  });

  /** Finding 5: the route a client asks for is the route it gets. */
  describe('choosing a route at creation', () => {
    it('defaults to the partner-direct route when no client says otherwise', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create({ partnerId, grossAmount: '5000' }, customer.user.id);
      expect(intent.paymentRoute).toBe(PaymentRoute.DIRECT_PARTNER);
    });

    it('honours an explicit in-TuTak route', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId, grossAmount: '5000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      expect(intent.paymentRoute).toBe(PaymentRoute.TUTAK_PSP);
    });

    it('still lets a cashier confirm a partner-direct purchase', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create({ partnerId, grossAmount: '5000' }, customer.user.id);
      await expect(intents.confirm(intent.id, staffId)).resolves.toBeDefined();
    });
  });

  /** Net movement on this partner's payable account, credits positive. */
  async function partnerPayable(): Promise<Decimal> {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
      select: { amount: true, direction: true },
    });
    return postings.reduce(
      (sum, p) =>
        p.direction === PostingDirection.CREDIT
          ? sum.plus(new Decimal(p.amount))
          : sum.minus(new Decimal(p.amount)),
      new Decimal(0),
    );
  }

  /** The same, broken down by what wrote it. */
  async function postingsByKind(type: LedgerAccountType): Promise<Map<string, Decimal>> {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type, partnerId } },
      select: { amount: true, direction: true, transaction: { select: { kind: true } } },
    });
    const out = new Map<string, Decimal>();
    for (const p of postings) {
      const signed =
        p.direction === PostingDirection.CREDIT ? new Decimal(p.amount) : new Decimal(p.amount).negated();
      out.set(p.transaction.kind, (out.get(p.transaction.kind) ?? new Decimal(0)).plus(signed));
    }
    return out;
  }
});
