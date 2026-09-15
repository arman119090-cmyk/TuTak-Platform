import {
  BonusEntryType,
  PaymentRoute,
  PrismaClient,
  PspAttemptStatus,
  PspCallbackKind,
  PspInboxStatus,
  PspResolutionBasis,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'node:crypto';
import { PspCallbackInboxService } from '../src/modules/psp/psp-callback-inbox.service';
import { PspCallbackWorkerService } from '../src/modules/psp/psp-callback-worker.service';
import { PspPaymentService } from '../src/modules/psp/psp-payment.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

const MERCHANT = '111222333';
const SECRET = 'test-idram-secret';

/**
 * The durable callback inbox, and the burst it exists for.
 *
 * ## What was measured before it existed
 *
 * A verified callback was settled inside the HTTP request that carried it:
 * one heavy transaction each, held for the whole write. Ten concurrent
 * callbacks for a single bill therefore wanted ten connections from a pool
 * of five, and **all ten failed** with "Unable to start a transaction in the
 * given time". Nothing was double-counted because nothing happened at all —
 * which is its own kind of wrong, because the customer had paid. A provider
 * seeing errors retries harder, so the failure was self-amplifying.
 *
 * Raising `connection_limit` moves that cliff and leaves it there. So the
 * boundary now proves the callback genuine, writes it down and answers; the
 * money moves afterwards, once, in a worker.
 *
 * These tests drive real HTTP, because the property under test is precisely
 * that the HTTP boundary survives what the settlement path could not.
 */
describe('PSP callback inbox (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  let inbox: PspCallbackInboxService;
  let worker: PspCallbackWorkerService;
  let psp: PspPaymentService;
  let intents: PurchaseIntentsService;
  let bonusEngine: BonusEngineService;

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY'] as const) {
      savedEnv[key] = process.env[key];
    }
    process.env.IDRAM_MERCHANT_ID = MERCHANT;
    process.env.IDRAM_SECRET_KEY = SECRET;

    harness = await createHttpTestHarness();
    prisma = harness.prisma;
    inbox = harness.app.get(PspCallbackInboxService);
    worker = harness.app.get(PspCallbackWorkerService);
    psp = harness.app.get(PspPaymentService);
    intents = harness.app.get(PurchaseIntentsService);
    bonusEngine = harness.app.get(BonusEngineService);
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

  /** A merchant-approved purchase with a live bill, ready to be paid. */
  async function billedPurchase(billId: string, gross = '15000', bonus = '1000') {
    const customer = await createCustomer(prisma);
    if (new Decimal(bonus).greaterThan(0)) {
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
        ...(new Decimal(bonus).greaterThan(0) ? { bonusAmountRequested: bonus } : {}),
        paymentRoute: PaymentRoute.TUTAK_PSP,
      },
      customer.user.id,
    );
    await intents.approveForPayment(intent.id, staffId, {});
    const remainder = new Decimal(gross).minus(bonus);
    const attempt = await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: remainder,
        providerBillId: billId,
        liveKey: 'live',
      },
    });
    return { customer, intent, attempt, remainder };
  }

  /** A genuine Idram final callback, checksummed the way the provider does. */
  function finalCallback(billId: string, amount: string, transId = 'IDRAM-1') {
    const fields: Record<string, string> = {
      EDP_REC_ACCOUNT: MERCHANT,
      EDP_AMOUNT: amount,
      EDP_BILL_NO: billId,
      EDP_PAYER_ACCOUNT: '55566677',
      EDP_TRANS_ID: transId,
      EDP_TRANS_DATE: '2026-09-15 12:00:00',
    };
    fields.EDP_CHECKSUM = createHash('md5')
      .update(
        [
          fields.EDP_REC_ACCOUNT,
          fields.EDP_AMOUNT,
          fields.EDP_BILL_NO,
          fields.EDP_PAYER_ACCOUNT,
          fields.EDP_TRANS_ID,
          fields.EDP_TRANS_DATE,
          SECRET,
        ].join(':'),
      )
      .digest('hex')
      .toUpperCase();
    return fields;
  }

  const post = (body: Record<string, string>) =>
    fetch(`${harness.baseUrl}/v1/psp/idram/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  // ── The burst ──────────────────────────────────────────────────────────

  it.each([20, 50])(
    'survives %i concurrent duplicate callbacks and settles once',
    async (count) => {
      const billId = `bill-burst-${count}`;
      const { intent } = await billedPurchase(billId);
      const body = finalCallback(billId, '14000', `IDRAM-BURST-${count}`);

      const responses = await Promise.all(Array.from({ length: count }, () => post(body)));

      // The HTTP boundary holds. Every single one is answered — this is the
      // property that failed before: all ten used to error, and a provider
      // that sees errors retries harder.
      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(await Promise.all(responses.map((r) => r.text()))).toEqual(
        Array.from({ length: count }, () => 'OK'),
      );

      // Exactly one unit of work, because the provider's own identity for
      // the event is the inbox's unique key.
      const rows = await prisma.pspCallbackInbox.findMany({ where: { billId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe(PspInboxStatus.RECEIVED);

      // And nothing has moved yet: the boundary does not settle.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
      ).toBe(0);

      const result = await worker.processPending();
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(0);

      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
      ).toBe(1);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } }),
      ).toBe(1);
      expect(
        (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
      ).toBe(PurchaseIntentStatus.CONFIRMED);
    },
    60_000,
  );

  it('answers a burst of distinct callbacks without starving the pool', async () => {
    // Twenty different bills arriving together — the case where the dedupe
    // key cannot help, because every one of them is real work.
    const bills = await Promise.all(
      Array.from({ length: 20 }, async (_unused, i) => {
        const billId = `bill-distinct-${i}`;
        await billedPurchase(billId, '15000', '0');
        return finalCallback(billId, '15000', `IDRAM-DISTINCT-${i}`);
      }),
    );

    const responses = await Promise.all(bills.map((body) => post(body)));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.pspCallbackInbox.count({ where: { verified: true } })).toBe(20);

    // Drained in batches; each settlement is its own transaction, run one at
    // a time on purpose — processing the batch in parallel would recreate
    // exactly the exhaustion this design avoids.
    let processed = 0;
    for (let pass = 0; pass < 5 && processed < 20; pass += 1) {
      processed += (await worker.processPending()).processed;
    }
    expect(processed).toBe(20);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
    ).toBe(20);
  }, 60_000);

  // ── Crash safety ───────────────────────────────────────────────────────

  it('loses nothing when the worker dies after the durable save', async () => {
    const billId = 'bill-crash-before';
    const { intent } = await billedPurchase(billId);
    await post(finalCallback(billId, '14000', 'IDRAM-CRASH-1'));

    // The worker picks it up and dies before doing anything.
    await expect(
      inbox.drain(() => {
        throw new Error('worker died');
      }),
    ).resolves.toMatchObject({ processed: 0, failed: 1 });

    const afterCrash = await prisma.pspCallbackInbox.findFirstOrThrow({ where: { billId } });
    expect(afterCrash.status).toBe(PspInboxStatus.RECEIVED);
    expect(afterCrash.attempts).toBe(1);
    // Nothing settled, and the row is still outstanding rather than lost.
    expect(afterCrash.pendingKey).not.toBeNull();

    // Backoff has pushed it out; a later pass picks it up and finishes.
    await prisma.pspCallbackInbox.update({
      where: { id: afterCrash.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    expect((await worker.processPending()).processed).toBe(1);
    expect(
      (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
    ).toBe(PurchaseIntentStatus.CONFIRMED);
  });

  it('costs a repeat and not a double when the worker dies after the ledger commit', async () => {
    const billId = 'bill-crash-after';
    const { intent } = await billedPurchase(billId);
    await post(finalCallback(billId, '14000', 'IDRAM-CRASH-2'));

    // The money moves, and then the process dies before the row is marked.
    // This is the case that decides whether at-least-once is safe here.
    await inbox
      .drain(async (row) => {
        await psp.settleVerifiedConfirmation({
          billId: row.billId!,
          providerTransactionId: row.providerTransactionId ?? '',
          amount: row.reportedAmount ?? new Decimal(0),
          raw: row.rawPayload,
        });
        throw new Error('died after committing the ledger');
      })
      .catch(() => undefined);

    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
    ).toBe(1);
    const stranded = await prisma.pspCallbackInbox.findFirstOrThrow({ where: { billId } });
    expect(stranded.status).toBe(PspInboxStatus.RECEIVED);

    // The retry re-runs the settlement, finds it already done, and marks the
    // row processed. One economic effect, not two.
    await prisma.pspCallbackInbox.update({
      where: { id: stranded.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    expect((await worker.processPending()).processed).toBe(1);

    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
    ).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } }),
    ).toBe(1);
    expect(
      (await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).status,
    ).toBe(PurchaseIntentStatus.CONFIRMED);
  });

  it('dead-letters a poison callback instead of retrying it for ever', async () => {
    const billId = 'bill-poison';
    await billedPurchase(billId);
    await post(finalCallback(billId, '14000', 'IDRAM-POISON'));

    for (let pass = 0; pass < 12; pass += 1) {
      await inbox.drain(() => {
        throw new Error('permanently broken');
      });
      await prisma.pspCallbackInbox.updateMany({
        where: { billId, pendingKey: { not: null } },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
    }

    const dead = await prisma.pspCallbackInbox.findFirstOrThrow({ where: { billId } });
    expect(dead.status).toBe(PspInboxStatus.DEAD);
    expect(dead.pendingKey).toBeNull();
    // Kept, alerted on, and out of the claim query — never silently dropped.
    expect(harness.alerts.matching('psp.callback-dead-letter').length).toBeGreaterThanOrEqual(1);
    expect(await inbox.deadLettered()).toHaveLength(1);
  });

  // ── Verification at the boundary ───────────────────────────────────────

  it.each([
    ['a forged checksum', (f: Record<string, string>) => ({ ...f, EDP_CHECKSUM: 'DEADBEEF' })],
    ['the wrong merchant', (f: Record<string, string>) => ({ ...f, EDP_REC_ACCOUNT: '999' })],
    ['a tampered amount', (f: Record<string, string>) => ({ ...f, EDP_AMOUNT: '1.00' })],
  ])('records but never acts on %s', async (_label, tamper) => {
    const billId = 'bill-forged';
    await billedPurchase(billId);
    const response = await post(tamper(finalCallback(billId, '14000', 'IDRAM-FORGED')));

    // Answered identically to a genuine one: telling an unauthenticated
    // caller *which* check failed tells an attacker which guess was closer.
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');

    const row = await prisma.pspCallbackInbox.findFirstOrThrow({
      where: { kind: PspCallbackKind.FINAL },
    });
    expect(row.verified).toBe(false);
    expect(row.status).toBe(PspInboxStatus.REJECTED);
    // Kept rather than discarded: a forged callback is evidence.
    expect(row.rawPayload).toBeTruthy();
    expect(row.rejectedReason).toBeTruthy();

    expect((await worker.processPending()).processed).toBe(0);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
    ).toBe(0);
  });

  it('never writes the merchant secret into the row it keeps', async () => {
    const billId = 'bill-secret';
    await billedPurchase(billId);
    await post(finalCallback(billId, '14000', 'IDRAM-SECRET'));

    const row = await prisma.pspCallbackInbox.findFirstOrThrow({ where: { billId } });
    // The checksum is a digest of the secret, not the secret. The key itself
    // lives only in the environment and must never reach a durable row.
    expect(JSON.stringify(row.rawPayload)).not.toContain(SECRET);
  });

  // ── Pre-check ──────────────────────────────────────────────────────────

  describe('pre-check', () => {
    const precheck = (billId: string, amount = '14000') => ({
      EDP_PRECHECK: 'YES',
      EDP_BILL_NO: billId,
      EDP_REC_ACCOUNT: MERCHANT,
      EDP_AMOUNT: amount,
    });

    it('says OK for a bill that may be paid, ten times, at zero cost', async () => {
      const billId = 'bill-precheck';
      await billedPurchase(billId);

      for (let i = 0; i < 10; i += 1) {
        const response = await post(precheck(billId));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('OK');
      }

      // A pre-check is the provider asking before it takes money. Ten of them
      // must cost exactly nothing ten times.
      expect(await prisma.ledgerTransaction.count()).toBe(0);
      expect(
        await prisma.pspPaymentAttempt.count({ where: { status: PspAttemptStatus.SUCCEEDED } }),
      ).toBe(0);
      // Recorded for the audit trail, and terminal: it can never become work
      // for the settlement worker.
      const rows = await prisma.pspCallbackInbox.findMany({
        where: { kind: PspCallbackKind.PRECHECK },
      });
      expect(rows.every((r) => r.status === PspInboxStatus.PROCESSED)).toBe(true);
      expect((await worker.processPending()).processed).toBe(0);
    });

    it.each([
      ['an unknown bill', () => ({ ...{}, billId: 'never-issued', amount: '14000' })],
      ['a different amount', () => ({ billId: 'bill-precheck-amt', amount: '1.00' })],
    ])('refuses %s', async (_label, build) => {
      await billedPurchase('bill-precheck-amt');
      const { billId, amount } = build();
      const response = await post(precheck(billId, amount));
      expect(await response.text()).toBe('NO');
    });

    /**
     * Defence in depth, fabricated at the table.
     *
     * Two separate guards already make this state unreachable: a bill cannot
     * be opened on an unapproved purchase, and the attempt's own trigger
     * refuses the insert. The pre-check checks it anyway, because it is the
     * last question asked before the provider takes money, and a pre-check
     * that says "yes" to a sale nobody agreed to is the one answer that
     * costs real money. Reaching it needs the approval removed after the
     * bill exists, and the freeze trigger has to be stepped around to do it.
     */
    it('refuses a bill whose purchase the merchant has not approved', async () => {
      const billId = 'bill-unapproved-precheck';
      const { intent } = await billedPurchase(billId, '15000', '0');

      await prisma.$executeRawUnsafe(
        'ALTER TABLE "purchase_intents" DISABLE TRIGGER "purchase_intents_approved_economics_frozen"',
      );
      try {
        await prisma.$executeRawUnsafe(
          'UPDATE "purchase_intents" SET "merchantApprovedAt" = NULL, "merchantApprovedByUserId" = NULL WHERE id = $1',
          intent.id,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "purchase_intents" ENABLE TRIGGER "purchase_intents_approved_economics_frozen"',
        );
      }

      expect(await (await post(precheck(billId, '15000'))).text()).toBe('NO');
    });

    it('refuses once the attempt has already resolved', async () => {
      const billId = 'bill-precheck-done';
      const { attempt } = await billedPurchase(billId);
      await prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: PspAttemptStatus.FAILED,
          resolutionBasis: PspResolutionBasis.PROVIDER_CALLBACK,
          liveKey: null,
          resolvedAt: new Date(),
        },
      });

      expect(await (await post(precheck(billId))).text()).toBe('NO');
    });
  });

  // ── What the customer is allowed to believe ────────────────────────────

  describe('customer-visible status', () => {
    it('walks the whole way without ever trusting a redirect', async () => {
      const billId = 'bill-status';
      const { customer, intent } = await billedPurchase(billId);

      expect((await psp.customerPaymentStatus(intent.id, customer.user.id)).state).toBe(
        'WAITING_PROVIDER',
      );

      await post(finalCallback(billId, '14000', 'IDRAM-STATUS'));
      // The provider has told us, and the money has not moved yet. The app
      // shows "processing" — never success, whatever URL the browser landed
      // on.
      expect((await psp.customerPaymentStatus(intent.id, customer.user.id)).state).toBe(
        'PROCESSING',
      );

      await worker.processPending();
      expect((await psp.customerPaymentStatus(intent.id, customer.user.id)).state).toBe(
        'SUCCEEDED',
      );
    });

    it('reports NOT_STARTED before a bill exists, whatever the browser did', async () => {
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId, grossAmount: '15000', paymentRoute: PaymentRoute.TUTAK_PSP },
        customer.user.id,
      );
      // The success URL is navigation. A customer who lands there having paid
      // nothing is still a customer who has paid nothing.
      expect((await psp.customerPaymentStatus(intent.id, customer.user.id)).state).toBe(
        'NOT_STARTED',
      );
    });

    it('will not show another customer their neighbour’s payment', async () => {
      const billId = 'bill-not-yours';
      const { intent } = await billedPurchase(billId);
      const stranger = await createCustomer(prisma);

      await expect(psp.customerPaymentStatus(intent.id, stranger.user.id)).rejects.toThrow(
        /not found/i,
      );
    });
  });
});
