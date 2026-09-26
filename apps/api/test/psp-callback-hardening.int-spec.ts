import { PaymentRoute, PrismaClient, PspAttemptStatus, PspInboxStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

const MERCHANT = '110000110';
const SECRET = 'contract-secret-key';

/**
 * The public callback route under hostile and merely broken input.
 *
 * Two things are established here that the other PSP suites do not.
 *
 * First, the wire format. Idram posts `application/x-www-form-urlencoded`,
 * not JSON, and every earlier test posted JSON — so the whole verified path
 * had never been exercised in the encoding the provider actually uses. The
 * contract vector from `idram.contract.spec.ts` is posted here as a form,
 * and the inbox must record it as verified.
 *
 * Second, that nothing on this route can produce a 500. The route is public
 * and the caller is a payment provider that treats a 5xx as "retry harder".
 * A malformed amount, a missing field, an array where a string belongs, a
 * body that is not an object — each is an ordinary refusal with a 200 and
 * the provider's own "no", never an exception escaping to the filter.
 */
describe('PSP callback hardening (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
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

  const url = () => `${harness.baseUrl}/v1/psp/idram/callback`;

  const postForm = (fields: Record<string, string | string[]>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => params.append(`${k}[]`, x));
      else params.append(k, v);
    }
    return fetch(url(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  };

  async function billedPurchase(billId: string, gross: string) {
    const customer = await createCustomer(prisma);
    const intent = await intents.create(
      { partnerId, grossAmount: gross, bonusAmountRequested: '0', paymentRoute: PaymentRoute.TUTAK_PSP },
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

  /** The exact vector pinned in idram.contract.spec.ts, on the wire. */
  const CONTRACT = {
    EDP_REC_ACCOUNT: MERCHANT,
    EDP_AMOUNT: '14000.00',
    EDP_BILL_NO: 'bill-contract-1',
    EDP_PAYER_ACCOUNT: 'payer@example',
    EDP_TRANS_ID: 'IDRAM-TX-777',
    EDP_TRANS_DATE: '19/09/2026 12:34:56',
    EDP_CHECKSUM: 'CF9A9178674067320EE1E57003BE6278',
  };

  it('verifies the documented contract vector posted as a form', async () => {
    await billedPurchase('bill-contract-1', '14000');
    const res = await postForm(CONTRACT);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');

    const row = await prisma.pspCallbackInbox.findFirstOrThrow({ where: { billId: 'bill-contract-1' } });
    expect(row.verified).toBe(true);
    expect(row.status).toBe(PspInboxStatus.RECEIVED);
    expect(row.providerTransactionId).toBe('IDRAM-TX-777');
  });

  describe('pre-check', () => {
    const precheck = (over: Record<string, string | string[]> = {}) =>
      postForm({ EDP_PRECHECK: 'YES', EDP_REC_ACCOUNT: MERCHANT, EDP_BILL_NO: 'bill-pc', EDP_AMOUNT: '5000.00', ...over });

    it('says OK for our merchant and a matching bill', async () => {
      await billedPurchase('bill-pc', '5000');
      const res = await precheck();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('OK');
    });

    /**
     * Item 2 of the review: a pre-check quoting a different merchant account
     * must get "no", and nothing financial may happen. A pre-check's only
     * effect is the answer, so the absence of a ledger entry is the whole
     * assertion.
     */
    it('says NO for a different merchant account, with no financial effect', async () => {
      await billedPurchase('bill-pc', '5000');
      const res = await precheck({ EDP_REC_ACCOUNT: '999999999' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('NO');
      expect(await prisma.ledgerTransaction.count()).toBe(0);
      // Recorded for the audit trail, as a refusal, and never as work.
      const row = await prisma.pspCallbackInbox.findFirstOrThrow({ where: { kind: 'PRECHECK' } });
      expect(row.verified).toBe(false);
      expect(row.rejectedReason).toMatch(/merchant/i);
      // Recorded as a refusal, and a refused pre-check can never become
      // work for the settlement worker.
      expect(row.status).toBe(PspInboxStatus.REJECTED);
    });

    it.each([
      ['a malformed amount', { EDP_AMOUNT: 'abc' }],
      ['an empty amount', { EDP_AMOUNT: '' }],
      ['an amount with a comma', { EDP_AMOUNT: '5,000.00' }],
      ['a negative amount', { EDP_AMOUNT: '-5000.00' }],
      ['an array-valued amount', { EDP_AMOUNT: ['5000.00', '1.00'] }],
      ['no bill number', { EDP_BILL_NO: '' }],
      ['an array-valued bill number', { EDP_BILL_NO: ['bill-pc', 'bill-other'] }],
    ])('answers NO, not 500, to %s', async (_label, over) => {
      await billedPurchase('bill-pc', '5000');
      const res = await precheck(over);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('NO');
    });
  });

  describe('final callback', () => {
    it.each([
      ['a malformed amount', { EDP_AMOUNT: 'abc' }],
      ['an empty bill number', { EDP_BILL_NO: '' }],
      ['an empty transaction id', { EDP_TRANS_ID: '' }],
      ['an empty checksum', { EDP_CHECKSUM: '' }],
      ['an array-valued checksum', { EDP_CHECKSUM: [CONTRACT.EDP_CHECKSUM, 'x'] }],
      ['an array-valued amount', { EDP_AMOUNT: ['14000.00', '1.00'] }],
    ])('records %s as rejected and moves no money', async (_label, over) => {
      await billedPurchase('bill-contract-1', '14000');
      const res = await postForm({ ...CONTRACT, ...over });
      expect(res.status).toBe(200);

      const row = await prisma.pspCallbackInbox.findFirst({ where: { kind: 'FINAL' } });
      expect(row?.verified ?? false).toBe(false);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'psp.payment.captured' } })).toBe(0);
    });

    it('survives a body that is not a form at all', async () => {
      for (const body of ['', 'just text', '[]', '"string"', '42']) {
        const res = await fetch(url(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        // Whatever the parser makes of it, the route answers rather than
        // crashing: anything but a 5xx.
        expect(res.status).toBeLessThan(500);
      }
      expect(await prisma.ledgerTransaction.count()).toBe(0);
    });
  });
});
