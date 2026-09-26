import { PaymentRoute, PrismaClient, PspAttemptStatus, PspInboxStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PspCallbackWorkerService } from '../src/modules/psp/psp-callback-worker.service';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The provider behaving badly, and the platform's answers.
 *
 * Every case here is something a real payment provider has done to somebody:
 * reused a transaction id, delivered a callback after the sale was already
 * unwound, or went quiet long enough for a worker's lease to lapse while the
 * work was still running. None of them are hypothetical, and none of them
 * were covered — the existing suites test the provider behaving *well* and
 * the platform racing itself.
 *
 * The bar in each case is the same: exactly one economic effect, and any
 * refusal visible rather than silent. A callback that is dropped quietly is
 * worse than one that errors, because a customer has paid either way.
 */
describe('PSP adversarial callbacks (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let psp: PspPaymentService;
  let worker: PspCallbackWorkerService;
  let intents: PurchaseIntentsService;

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.TUTAK_PSP_ENABLED = process.env.TUTAK_PSP_ENABLED;
    process.env.TUTAK_PSP_ENABLED = 'true';
    harness = await createTestHarness();
    prisma = harness.prisma;
    psp = harness.app.get(PspPaymentService);
    worker = harness.app.get(PspCallbackWorkerService);
    intents = harness.app.get(PurchaseIntentsService);
  });

  afterAll(async () => {
    if (savedEnv.TUTAK_PSP_ENABLED === undefined) delete process.env.TUTAK_PSP_ENABLED;
    else process.env.TUTAK_PSP_ENABLED = savedEnv.TUTAK_PSP_ENABLED;
    await harness.close();
  });

  let partnerId = '';
  let staffId = '';

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    staffId = (await createStaffUser(prisma)).id;
  });

  async function billedPurchase(billId: string, gross = '15000') {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      {
        partnerId,
        grossAmount: gross,
        bonusAmountRequested: '0',
        paymentRoute: PaymentRoute.TUTAK_PSP,
      },
      customer.user.id,
    );
    await intents.approveForPayment(intent.id, staffId, {});
    await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: new Decimal(gross),
        providerBillId: billId,
        liveKey: 'live',
      },
    });
    return intent.id;
  }

  const confirmation = (billId: string, txId: string, amount = '15000') => ({
    billId,
    providerTransactionId: txId,
    amount: new Decimal(amount),
    raw: { EDP_BILL_NO: billId, EDP_TRANS_ID: txId },
  });

  /**
   * The provider reuses a transaction id across two genuinely different
   * bills.
   *
   * `@@unique([provider, providerTransactionId])` is what stops the second
   * one being recorded, and the point of this test is what the *refusal*
   * looks like: the first sale must be fully settled, the second must move no
   * money at all, and the failure must be loud. Settling the second by
   * quietly dropping the transaction id would destroy the only handle anybody
   * has for asking the provider what happened.
   */
  it('refuses a second bill reusing another bill’s transaction id, and settles the first', async () => {
    const first = await billedPurchase('bill-dup-a');
    const second = await billedPurchase('bill-dup-b');

    await psp.settleVerifiedConfirmation(confirmation('bill-dup-a', 'IDRAM-SHARED'));
    await expect(
      psp.settleVerifiedConfirmation(confirmation('bill-dup-b', 'IDRAM-SHARED')),
    ).rejects.toThrow();

    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(
      1,
    );
    expect((await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: first } })).status).toBe(
      'CONFIRMED',
    );
    // The second sale is untouched — not half-settled, not confirmed.
    expect((await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: second } })).status).toBe(
      'AWAITING_CONFIRMATION',
    );
    const secondAttempt = await prisma.pspPaymentAttempt.findFirstOrThrow({
      where: { providerBillId: 'bill-dup-b' },
    });
    expect(secondAttempt.status).toBe(PspAttemptStatus.INITIATED);
  });

  /**
   * Two different transaction ids for one bill — the provider retrying its
   * own capture and giving the retry a new id.
   *
   * The first settles. The second must be a replay, not a second payment:
   * the attempt is already SUCCEEDED and the money for that bill has moved
   * once.
   */
  it('treats a second transaction id on an already-settled bill as a replay', async () => {
    await billedPurchase('bill-two-ids');
    await psp.settleVerifiedConfirmation(confirmation('bill-two-ids', 'IDRAM-FIRST'));

    const again = await psp.settleVerifiedConfirmation(confirmation('bill-two-ids', 'IDRAM-SECOND'));

    expect(again.alreadySettled).toBe(true);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(
      1,
    );
    // The recorded transaction id stays the one the money actually moved
    // under, not whichever arrived last.
    const attempt = await prisma.pspPaymentAttempt.findFirstOrThrow({
      where: { providerBillId: 'bill-two-ids' },
    });
    expect(attempt.providerTransactionId).toBe('IDRAM-FIRST');
  });

  /**
   * A worker that died mid-flight, and a second worker that reclaims the row
   * once the lease lapses.
   *
   * This is the reachable version of the scenario. The first shape I wrote —
   * forcing an already-PROCESSED row back to PROCESSING — turned out to be
   * impossible: `psp_callback_inbox` refuses any change to a processed
   * callback at the database level, so a processed row cannot be resurrected
   * by a buggy worker, a careless migration or a console session. That is a
   * stronger guarantee than the test assumed, and finding it is worth more
   * than the test I meant to write.
   *
   * What *can* happen is a worker claiming a row, taking the lease, and
   * dying before it commits anything. The row then sits PROCESSING with a
   * lapsed lease — which is what a killed container or a long stop-the-world
   * pause looks like from the database's side — and the next worker must pick
   * it up and settle it exactly once.
   */
  it('lets a second worker finish what a dead one claimed, settling once', async () => {
    const intentId = await billedPurchase('bill-lease');

    // Claimed and abandoned: PROCESSING, lease already in the past, never
    // processed, one attempt already spent.
    await prisma.pspCallbackInbox.create({
      data: {
        provider: 'idram',
        kind: 'FINAL',
        status: PspInboxStatus.PROCESSING,
        dedupeKey: 'idram:FINAL:bill-lease:IDRAM-LEASE',
        billId: 'bill-lease',
        providerTransactionId: 'IDRAM-LEASE',
        reportedAmount: new Decimal('15000'),
        verified: true,
        rawPayload: { EDP_BILL_NO: 'bill-lease' },
        pendingKey: 'pending',
        attempts: 1,
        leaseUntil: new Date(Date.now() - 60_000),
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await worker.processPending();

    expect(result.failed).toBe(0);
    expect(result.processed).toBe(1);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(
      1,
    );
    expect((await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe(
      'CONFIRMED',
    );
  });

  /**
   * And the guarantee the failed attempt above uncovered, asserted directly:
   * a processed callback is immutable. Nothing may reopen it — not a worker,
   * not a migration, not somebody at a psql prompt.
   */
  it('refuses to reopen a callback that has already been processed', async () => {
    await billedPurchase('bill-immutable');
    await prisma.pspCallbackInbox.create({
      data: {
        provider: 'idram',
        kind: 'FINAL',
        status: PspInboxStatus.RECEIVED,
        dedupeKey: 'idram:FINAL:bill-immutable:IDRAM-IMM',
        billId: 'bill-immutable',
        providerTransactionId: 'IDRAM-IMM',
        reportedAmount: new Decimal('15000'),
        verified: true,
        rawPayload: { EDP_BILL_NO: 'bill-immutable' },
        pendingKey: 'pending',
      },
    });
    expect((await worker.processPending()).processed).toBe(1);

    await expect(
      prisma.pspCallbackInbox.updateMany({
        where: { billId: 'bill-immutable' },
        data: { status: PspInboxStatus.RECEIVED, processedAt: null, pendingKey: 'pending' },
      }),
    ).rejects.toThrow(/has been processed and cannot be changed/i);
  });

  /**
   * A callback for a bill this platform never opened.
   *
   * Either an attack or a lost row, and both need somebody to look. What it
   * must never be is a settlement, and what it must never do is vanish.
   */
  it('refuses a callback for an unknown bill rather than inventing a purchase', async () => {
    await expect(
      psp.settleVerifiedConfirmation(confirmation('bill-never-opened', 'IDRAM-GHOST')),
    ).rejects.toThrow(/unknown bill/i);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(
      0,
    );
  });
});
