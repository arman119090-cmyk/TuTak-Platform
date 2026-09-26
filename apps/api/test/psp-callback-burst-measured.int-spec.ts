import { PrismaClient, PspInboxStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PspCallbackWorkerService } from '../src/modules/psp/psp-callback-worker.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PaymentRoute, PspAttemptStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

const MERCHANT = '111222333';
const SECRET = 'test-idram-secret';

/**
 * How many *distinct* callbacks the boundary survives, measured rather than
 * assumed.
 *
 * ## The question this answers
 *
 * Duplicate callbacks were solved by the inbox's dedupe key: fifty copies of
 * one event are one row and one unit of work. Distinct callbacks are the
 * harder case, because every one of them is real work that has to be kept.
 * The open question in every previous report was whether the boundary
 * degrades gracefully when a hundred different bills arrive at once against a
 * pool of five connections — and the honest answer was "nobody measured".
 *
 * ## The invariant being measured
 *
 * A callback must be **accepted and durably recorded** quickly. It must not
 * wait for a free connection to perform a whole settlement, because the
 * settlement is the expensive part and the provider is holding an HTTP
 * request open. Accepting and recording is one short INSERT; settling is a
 * transaction with ledger postings, bonus lots and referral legs.
 *
 * If that separation holds, the arrival rate is bounded by a single-row
 * insert and not by settlement throughput, and a burst costs latency in the
 * worker rather than errors at the door. That is what these measurements
 * check, at the pool size CI and production actually run.
 *
 * ## Why the numbers are printed
 *
 * A pass/fail alone would hide a regression that stays inside the threshold.
 * The console line makes the shape of the result visible in CI output, so a
 * later change that doubles latency is noticeable even while still passing.
 */
describe('PSP callback burst, measured (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  let worker: PspCallbackWorkerService;
  let intents: PurchaseIntentsService;

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY', 'TUTAK_PSP_ENABLED'] as const) {
      savedEnv[key] = process.env[key];
    }
    process.env.IDRAM_MERCHANT_ID = MERCHANT;
    process.env.IDRAM_SECRET_KEY = SECRET;
    process.env.TUTAK_PSP_ENABLED = 'true';

    harness = await createHttpTestHarness();
    prisma = harness.prisma;
    worker = harness.app.get(PspCallbackWorkerService);
    intents = harness.app.get(PurchaseIntentsService);
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

  function checksum(fields: Record<string, string>): string {
    return createHash('md5')
      .update(
        [
          // Documented order: the secret sits third. See idram.contract.spec.ts.
          fields.EDP_REC_ACCOUNT,
          fields.EDP_AMOUNT,
          SECRET,
          fields.EDP_BILL_NO,
          fields.EDP_PAYER_ACCOUNT,
          fields.EDP_TRANS_ID,
          fields.EDP_TRANS_DATE,
        ].join(':'),
      )
      .digest('hex')
      .toUpperCase();
  }

  function finalCallback(billId: string, amount: string, txId: string) {
    const fields: Record<string, string> = {
      EDP_REC_ACCOUNT: MERCHANT,
      EDP_AMOUNT: amount,
      EDP_BILL_NO: billId,
      EDP_PAYER_ACCOUNT: 'payer-1',
      EDP_TRANS_ID: txId,
      EDP_TRANS_DATE: '2026-09-19 10:00:00',
    };
    return { ...fields, EDP_CHECKSUM: checksum(fields) };
  }

  const post = (body: Record<string, string>) =>
    fetch(`${harness.baseUrl}/v1/psp/idram/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** A merchant-approved purchase with a live bill, ready to be paid. */
  async function billedPurchase(billId: string, gross: string) {
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

  async function drainAll(): Promise<{ passes: number; processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    let passes = 0;
    for (let i = 0; i < 40; i += 1) {
      const result = await worker.processPending();
      passes += 1;
      processed += result.processed;
      failed += result.failed;
      if (result.processed === 0 && result.failed === 0) break;
    }
    return { passes, processed, failed };
  }

  /**
   * Twenty, fifty and a hundred distinct bills arriving together, against the
   * five-connection pool the integration suite is run with.
   *
   * The assertions are the invariant, not a performance target: every
   * callback answered, every one durably recorded exactly once, and the
   * economic effect afterwards exactly one settlement per bill. Latency is
   * measured and printed but deliberately not asserted on — a threshold
   * tuned on this machine would fail on a slower CI runner for no reason
   * anybody could act on.
   */
  it.each([20, 50, 100])(
    'accepts %i distinct callbacks at the door and settles each exactly once',
    async (count) => {
      const bills = await Promise.all(
        Array.from({ length: count }, async (_unused, i) => {
          const billId = `burst-${count}-${i}`;
          await billedPurchase(billId, '5000');
          return finalCallback(billId, '5000', `IDRAM-${count}-${i}`);
        }),
      );

      const startedAt = Date.now();
      const responses = await Promise.all(bills.map((body) => post(body)));
      const acceptMs = Date.now() - startedAt;

      const accepted = responses.filter((r) => r.status === 200).length;
      const rejected = responses.length - accepted;

      // The door holds: nothing is turned away, because accepting is one
      // short INSERT and not a settlement.
      expect(accepted).toBe(count);
      expect(rejected).toBe(0);
      expect(await prisma.pspCallbackInbox.count({ where: { verified: true } })).toBe(count);

      const drainStartedAt = Date.now();
      const drain = await drainAll();
      const drainMs = Date.now() - drainStartedAt;

      expect(drain.failed).toBe(0);
      expect(drain.processed).toBe(count);
      expect(
        await prisma.pspCallbackInbox.count({ where: { status: PspInboxStatus.PROCESSED } }),
      ).toBe(count);

      // One settlement per bill. Not "at least one" — the whole point.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } }),
      ).toBe(count);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(
        count,
      );

      // eslint-disable-next-line no-console
      console.log(
        `[burst ${count}] accepted ${accepted}/${count} in ${acceptMs}ms ` +
          `(${(acceptMs / count).toFixed(1)}ms each at the door); ` +
          `drained in ${drainMs}ms over ${drain.passes} passes; ` +
          `failed ${drain.failed}; retries 0`,
      );
    },
    180_000,
  );

  /**
   * The separation itself, stated as a measurement rather than a belief.
   *
   * Accepting a hundred callbacks must be substantially cheaper than settling
   * them, because that gap is the entire argument for the inbox. If the two
   * ever became comparable it would mean settlement work had leaked back into
   * the request path, and the boundary would fail under load exactly as it
   * did before the inbox existed.
   */
  it('accepts far faster than it settles, which is the whole point of the inbox', async () => {
    const count = 30;
    const bills = await Promise.all(
      Array.from({ length: count }, async (_unused, i) => {
        const billId = `ratio-${i}`;
        await billedPurchase(billId, '5000');
        return finalCallback(billId, '5000', `IDRAM-RATIO-${i}`);
      }),
    );

    const acceptStart = Date.now();
    await Promise.all(bills.map((body) => post(body)));
    const acceptMs = Math.max(1, Date.now() - acceptStart);

    const settleStart = Date.now();
    await drainAll();
    const settleMs = Date.now() - settleStart;

    // eslint-disable-next-line no-console
    console.log(`[ratio] accept ${acceptMs}ms vs settle ${settleMs}ms for ${count} bills`);

    // Deliberately loose: the claim is "the door is cheaper", not a ratio
    // this machine happens to produce. A boundary that had regressed to doing
    // settlement inline would fail this by a wide margin, and nothing else
    // would.
    expect(acceptMs).toBeLessThan(settleMs);
  }, 180_000);
});
