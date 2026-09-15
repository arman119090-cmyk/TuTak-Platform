import {
  LedgerAccountType,
  PaymentRoute,
  PostingDirection,
  PrismaClient,
  PspAttemptStatus,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createPartner, createStaffUser } from './setup/fixtures';
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

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
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

  /** A purchase on the given route, written directly — this suite is about
   *  routing and settlement, not about the purchase-creation path. */
  async function purchase(route: PaymentRoute, remainder = '14000') {
    const customer = await createStaffUser(prisma);
    return prisma.purchaseIntent.create({
      data: {
        customerId: customer.id,
        partnerId,
        status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
        grossAmount: new Decimal('15000'),
        bonusAmountRequested: new Decimal('1000'),
        ordinaryPaymentRemainder: new Decimal(remainder),
        negotiatedRateBps: 300,
        maxBonusPaymentPercent: 100,
        paymentRoute: route,
        expiresAt: new Date(Date.now() + 180_000),
      },
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
});
