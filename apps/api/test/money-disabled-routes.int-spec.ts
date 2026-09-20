import { JwtService } from '@nestjs/jwt';
import {
  PaymentRoute,
  PrismaClient,
  PspAttemptStatus,
  PspInboxStatus,
  PurchaseIntentStatus,
  RoleName,
  User,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

/**
 * The money flags, exercised through the public HTTP surface.
 *
 * `money-disabled-gate.int-spec.ts` proves the *services* refuse while the
 * flags are absent. That leaves a gap this suite closes: a route is more
 * than its service. A controller reaching a different method, a guard that
 * is missing, a DTO that rejects before the gate is reached, or a refusal
 * that surfaces as a 500 instead of a clean 4xx are all failures of the
 * deployment that a service-level test cannot see. So every attempt below
 * is a real request, with a real bearer token, against the same routes the
 * apps call — and production's state is reproduced exactly: the three
 * variables are *deleted*, not set to "false", and provider credentials are
 * present on purpose so nothing but the flag stands in the way.
 *
 * The last test is the other half of the contract: the ordinary till route
 * keeps working through the same surface, because a gate that also closed
 * the existing business would be a different bug, not safety.
 */
describe('Money flags off, through the API routes (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  let jwt: JwtService;

  const MERCHANT = '110000110';
  const FLAGS = [
    'TUTAK_PSP_ENABLED',
    'PSP_REFUNDS_ENABLED',
    'CUSTOMER_PREPAID_TOPUP_ENABLED',
    // The hybrid-funding flags (20.09.2026): off in production like the rest.
    'CUSTOMER_PREPAID_PURCHASE_ENABLED',
    'PARTNER_POS_PURCHASES_ENABLED',
  ] as const;
  const CREDS = ['IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY', 'IDRAM_FORM_ACTION'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [...FLAGS, ...CREDS]) saved[key] = process.env[key];
    for (const key of FLAGS) delete process.env[key];
    process.env.IDRAM_MERCHANT_ID = MERCHANT;
    process.env.IDRAM_SECRET_KEY = 'staged-ahead-of-activation';
    process.env.IDRAM_FORM_ACTION = 'https://sandbox.idram.example/Payment/GetPayment';

    harness = await createHttpTestHarness({ authGuards: true });
    prisma = harness.prisma;
    jwt = harness.app.get(JwtService);
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await harness.close();
  });

  let partnerId = '';
  let owner: User;

  beforeEach(async () => {
    await truncateAll(prisma);
    partnerId = (await createPartner(prisma)).id;
    owner = await createStaffUser(prisma);
    // Roles are seeded once by the global setup and survive `truncateAll`.
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
    await prisma.userRole.create({
      data: { userId: owner.id, roleId: role.id, partnerId, allBranches: true },
    });
  });

  const tokenFor = (user: User) =>
    jwt.signAsync({ sub: user.id, phone: user.phone, deviceId: 'device-routes' }, { expiresIn: '15m' });

  const api = async (
    user: User,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: Record<string, unknown> }> => {
    const res = await fetch(`${harness.baseUrl}/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await tokenFor(user)}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, data: parsed };
  };

  /** A provider-routed purchase that outlived the flag, as a row in the table. */
  async function strandedProviderPurchase(
    customerId: string,
    status: PurchaseIntentStatus = PurchaseIntentStatus.AWAITING_CONFIRMATION,
  ) {
    return prisma.purchaseIntent.create({
      data: {
        customerId,
        partnerId,
        status,
        paymentRoute: PaymentRoute.TUTAK_PSP,
        grossAmount: '15000',
        bonusAmountRequested: '0',
        ordinaryPaymentRemainder: '15000',
        negotiatedRateBps: 500,
        maxBonusPaymentPercent: 50,
        confirmationCode: '4242',
        expiresAt: new Date(Date.now() + 3 * 60_000),
        merchantApprovedByUserId: owner.id,
        merchantApprovedAt: new Date(),
        ...(status === PurchaseIntentStatus.CONFIRMED
          ? { confirmedByUserId: owner.id, confirmedAt: new Date() }
          : {}),
      },
    });
  }

  it('refuses to create a provider-routed purchase', async () => {
    const { user } = await createCustomer(prisma);
    const res = await api(user, 'POST', '/purchase-intents', {
      partnerId,
      grossAmount: '15000',
      paymentRoute: PaymentRoute.TUTAK_PSP,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.data)).toMatch(/not available/i);
    expect(await prisma.purchaseIntent.count()).toBe(0);
  });

  it('refuses to open a provider bill, cleanly, and writes nothing', async () => {
    const { user } = await createCustomer(prisma);
    const intent = await strandedProviderPurchase(user.id);

    const res = await api(user, 'POST', `/psp/purchases/${intent.id}/begin`);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.data)).toMatch(/not available/i);
    expect(await prisma.pspPaymentAttempt.count()).toBe(0);

    // The status route stays informative: nothing has happened.
    const status = await api(user, 'GET', `/psp/purchases/${intent.id}/status`);
    expect(status.status).toBe(200);
    expect(JSON.stringify(status.data)).not.toMatch(/SUCCEEDED/);
  });

  it('answers NO to a pre-check for an existing bill, and records why', async () => {
    const { user } = await createCustomer(prisma);
    const intent = await strandedProviderPurchase(user.id);
    await prisma.pspPaymentAttempt.create({
      data: {
        purchaseIntentId: intent.id,
        provider: 'idram',
        status: PspAttemptStatus.INITIATED,
        amount: new Decimal('15000'),
        providerBillId: 'bill-off',
        liveKey: 'live',
      },
    });

    const form = new URLSearchParams({
      EDP_PRECHECK: 'YES',
      EDP_REC_ACCOUNT: MERCHANT,
      EDP_BILL_NO: 'bill-off',
      EDP_AMOUNT: '15000.00',
    });
    const res = await fetch(`${harness.baseUrl}/v1/psp/idram/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('NO');

    const row = await prisma.pspCallbackInbox.findFirstOrThrow({ where: { kind: 'PRECHECK' } });
    expect(row.status).toBe(PspInboxStatus.REJECTED);
    expect(row.rejectedReason).toMatch(/disabled/i);
    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });

  it('has no prepaid top-up route at all', async () => {
    const { user } = await createCustomer(prisma);
    const res = await api(user, 'POST', '/balance/topup', { amount: '1000', idempotencyKey: randomUUID() });
    expect(res.status).toBe(404);
    expect(await api(user, 'GET', '/balance/me')).toMatchObject({ status: 404 });
  });

  it('refuses to refund a provider-collected purchase, before touching money', async () => {
    const { user } = await createCustomer(prisma);
    const intent = await strandedProviderPurchase(user.id, PurchaseIntentStatus.CONFIRMED);

    const res = await api(owner, 'POST', `/purchase-intents/${intent.id}/refund`, {
      reason: 'customer changed their mind',
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.data)).toMatch(/not available yet/i);
    expect(await prisma.purchaseIntentRefund.count()).toBe(0);
    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });

  it('leaves the ordinary till route working end to end', async () => {
    const { user } = await createCustomer(prisma);
    const created = await api(user, 'POST', '/purchase-intents', { partnerId, grossAmount: '10000' });
    expect(created.status).toBe(201);
    const dto = created.data.data as { id: string; status: string; paymentRoute?: string };
    expect(dto.paymentRoute ?? PaymentRoute.DIRECT_PARTNER).toBe(PaymentRoute.DIRECT_PARTNER);

    const confirmed = await api(owner, 'POST', `/purchase-intents/${dto.id}/confirm`, {});
    expect(confirmed.status).toBe(201);
    expect((confirmed.data.data as { status: string }).status).toBe(PurchaseIntentStatus.CONFIRMED);

    // Real economic effect, on the route that was always allowed.
    expect(await prisma.ledgerTransaction.count()).toBeGreaterThan(0);
    expect(await prisma.pspPaymentAttempt.count()).toBe(0);
  });
});
