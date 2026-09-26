import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { LedgerAccountType as A, PrismaClient, RoleName } from '@prisma/client';
import { PartnerIntegrationsService } from '../src/modules/partners/partner-integrations.service';
import { PartnerApiKeyService } from '../src/modules/partners/partner-api-key.service';
import { CustomerBalanceService } from '../src/modules/customer-balance/customer-balance.service';
import { BANK_TOPUP_ADAPTER, BankTopUpAdapter } from '../src/modules/customer-balance/bank-topup-adapter.interface';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

/**
 * Partner Commerce end to end over real HTTP, with the production guard
 * chain (JWT → roles → permissions): the partner's backend creates an order
 * with its API key, the customer confirms it in TuTak checkout, the
 * partner's cashier starts a shift and confirms the cash, the customer
 * confirms receipt — and the authorization rules of spec §62 hold on the way.
 */
describe('Partner Commerce over HTTP (e2e, real auth guards)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

  beforeAll(async () => {
    harness = await createHttpTestHarness({ authGuards: true });
    prisma = harness.prisma;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const token = (user: { id: string; phone: string }) =>
    jwt.sign({ sub: user.id, phone: user.phone, deviceId: 'e2e' }, { algorithm: 'HS256', expiresIn: '10m' });

  async function call(method: string, path: string, opts: { auth?: string; apiKey?: string; body?: unknown } = {}) {
    const response = await fetch(`${harness.baseUrl}/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}),
        ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const json = (await response.json().catch(() => null)) as { data?: unknown; message?: unknown; code?: string } | null;
    return { status: response.status, data: json?.data as never, error: json };
  }

  async function withRole(userId: string, role: RoleName, partnerId?: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userRole.create({ data: { userId, roleId: r.id, partnerId } });
  }

  async function world() {
    const app = (harness.app as unknown as { get<T>(t: unknown): T });
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, shiftsRequiredFrom: new Date('2020-01-01') });
    const other = await createPartner(prisma, { displayName: 'Other partner' });
    const admin = await createStaffUser(prisma);
    await withRole(admin.id, RoleName.SUPER_ADMIN);
    const integrations = app.get<PartnerIntegrationsService>(PartnerIntegrationsService);
    const integration = await integrations.create(partner.id, { type: 'WEBSITE', websiteUrl: 'https://shop.test' }, admin.id);
    await integrations.markWebsiteVerified(partner.id, integration.id, admin.id);
    const key = await app.get<PartnerApiKeyService>(PartnerApiKeyService).issue({ partnerId: partner.id, integrationId: integration.id, label: 'site' });
    const branch = await prisma.partnerBranch.create({
      data: { partnerId: partner.id, name: 'Online / office', address: 'Yerevan', city: 'Yerevan', latitude: 40.18, longitude: 44.51 },
    });
    const { user: cashier } = await createCustomer(prisma);
    await withRole(cashier.id, RoleName.PARTNER_STAFF, partner.id);
    await prisma.partnerBranchStaffAssignment.create({
      data: { partnerId: partner.id, partnerBranchId: branch.id, userId: cashier.id, assignedByUserId: admin.id, employeeDisplayCode: 'C-1' },
    });
    const { user: owner } = await createCustomer(prisma);
    await withRole(owner.id, RoleName.PARTNER_OWNER, partner.id);
    const { user: foreignOwner } = await createCustomer(prisma);
    await withRole(foreignOwner.id, RoleName.PARTNER_OWNER, other.id);
    const { user: customer } = await createCustomer(prisma);
    await withRole(customer.id, RoleName.CUSTOMER);
    const { user: stranger } = await createCustomer(prisma);
    await withRole(stranger.id, RoleName.CUSTOMER);
    // Real money through the real top-up flow; only the bank's network edge is faked.
    const bank = app.get<BankTopUpAdapter>(BANK_TOPUP_ADAPTER);
    const providerReference = `P-${randomUUID()}`;
    jest.spyOn(bank, 'initiateTopUp').mockResolvedValueOnce({ outcome: 'INITIATED', providerReference });
    const balance = app.get<CustomerBalanceService>(CustomerBalanceService);
    await balance.initiateTopUp(customer.id, '20000');
    jest.spyOn(bank, 'verifyTopUpWebhook').mockResolvedValueOnce({ providerReference, outcome: 'COMPLETED' });
    await balance.confirmTopUpWebhook({ reference: providerReference }, {});
    return { partner, other, admin, apiKey: key.apiKey, branch, cashier, owner, foreignOwner, customer, stranger };
  }

  it('create → checkout → confirm → seen → in stock → shift → cash → received → completed', async () => {
    const w = await world();
    const created = await call('POST', '/partner-orders', {
      apiKey: w.apiKey,
      body: { externalOrderId: 'SITE-1', branchId: w.branch.id, items: [{ name: 'Brake pads', quantity: 1, unitPrice: '30000' }] },
    });
    expect(created.status).toBe(201);
    const orderId = (created.data as { id: string }).id;
    // The partner's site only learns what it needs to build the checkout link.
    expect(Object.keys(created.data as object).sort()).toEqual(
      ['currency', 'draftExpiresAt', 'externalOrderId', 'id', 'operationalStatus', 'orderNumber', 'paymentStatus', 'totalAmount'].sort(),
    );
    expect((await call('POST', '/partner-orders', { body: { externalOrderId: 'X', items: [] } })).status).toBe(401);

    const checkout = await call('GET', `/partner-orders/${orderId}/checkout`, { auth: token(w.customer) });
    expect(checkout.status).toBe(200);
    const view = (checkout.data as { order: Record<string, unknown> }).order;
    expect(view.commissionRateBps).toBeUndefined();
    expect(view.commissionAmount).toBeUndefined();
    expect(view.customerStatus).toBe('awaiting_confirmation');

    const submitted = await call('POST', `/partner-orders/${orderId}/submit`, {
      auth: token(w.customer),
      body: { tutakMoneyAmount: '10000', idempotencyKey: 'e2e-submit-1' },
    });
    expect(submitted.status).toBe(201);
    // A reused checkout link is refused to anyone else.
    expect((await call('GET', `/partner-orders/${orderId}/checkout`, { auth: token(w.stranger) })).status).toBe(404);

    // Partner A can never see partner B's queue, and vice versa.
    expect((await call('GET', `/partner-orders?partnerId=${w.partner.id}`, { auth: token(w.foreignOwner) })).status).toBe(403);
    expect((await call('POST', `/partner-orders/${orderId}/seen`, { auth: token(w.foreignOwner) })).status).toBe(403);

    expect((await call('POST', `/partner-orders/${orderId}/seen`, { auth: token(w.cashier) })).status).toBe(201);
    expect((await call('POST', `/partner-orders/${orderId}/confirm-stock`, { auth: token(w.cashier) })).status).toBe(201);
    expect((await call('POST', `/partner-orders/${orderId}/handed-over`, { auth: token(w.cashier) })).status).toBe(201);

    const order = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: orderId }, include: { paymentLegs: true } });
    const cashLeg = order.paymentLegs.find((l) => l.type === 'EXTERNAL')!;
    const moneyLeg = order.paymentLegs.find((l) => l.type === 'TUTAK_MONEY')!;
    // The partner can confirm only the leg its own side is responsible for — never an electronic one.
    expect((await call('POST', `/partner-orders/legs/${moneyLeg.id}/confirm-external`, { auth: token(w.cashier) })).status).toBe(404);
    const noShift = await call('POST', `/partner-orders/legs/${cashLeg.id}/confirm-external`, { auth: token(w.cashier) });
    expect(noShift.status).toBe(403);
    expect(noShift.error?.code).toBe('SHIFT_REQUIRED');

    expect((await call('POST', '/shifts/start', { auth: token(w.cashier), body: { branchId: w.branch.id } })).status).toBe(201);
    expect((await call('POST', `/partner-orders/legs/${cashLeg.id}/confirm-external`, { auth: token(w.cashier) })).status).toBe(201);

    // Only the customer can say they received it.
    expect((await call('POST', `/partner-orders/${orderId}/received`, { auth: token(w.stranger) })).status).toBe(404);
    const received = await call('POST', `/partner-orders/${orderId}/received`, { auth: token(w.customer) });
    expect(received.status).toBe(201);
    expect((received.data as { customerStatus: string }).customerStatus).toBe('received');

    const final = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(final.operationalStatus).toBe('COMPLETED');
    const payable = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: A.PARTNER_PAYABLE, partnerId: w.partner.id } });
    // 10000 electronic receivable − 1500 pool on the full 30000.
    expect(payable.balance.toFixed(4)).toBe('-8500.0000');

    const summary = await call('GET', `/settlement/partners/${w.partner.id}/summary`, { auth: token(w.owner) });
    expect(summary.status).toBe(200);
    expect((summary.data as { dueToPartner: string }).dueToPartner).toBe('8500.0000');
    expect((await call('GET', `/settlement/partners/${w.partner.id}/summary`, { auth: token(w.foreignOwner) })).status).toBe(403);
  });

  it('a partner can never set its own commission, settlement period or shift date; a platform admin can', async () => {
    const w = await world();
    const rule = { partnerId: w.partner.id, serviceType: 'parts', name: 'self-serve', rateBps: 50 };
    expect((await call('POST', '/admin/partner-orders/commission-rules', { auth: token(w.owner), body: rule })).status).toBe(403);
    expect((await call('POST', `/settlement/partners/${w.partner.id}/period`, { auth: token(w.owner), body: { period: 'DAILY' } })).status).toBe(403);
    expect(
      (await call('POST', `/shifts/admin/partners/${w.partner.id}/required-from`, { auth: token(w.owner), body: { at: '2099-01-01T00:00:00Z' } })).status,
    ).toBe(403);
    expect((await call('GET', '/admin/partner-orders/queue?queue=all', { auth: token(w.owner) })).status).toBe(403);
    expect((await call('POST', '/admin/partner-orders/commission-rules', { auth: token(w.admin), body: rule })).status).toBe(201);
    expect((await call('POST', `/settlement/partners/${w.partner.id}/period`, { auth: token(w.admin), body: { period: 'WEEKLY' } })).status).toBe(201);
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: w.partner.id } })).settlementPeriod).toBe('WEEKLY');
  });

  it('the customer cannot pay with a currency other than AMD, and nobody unauthenticated reaches checkout', async () => {
    const w = await world();
    const bad = await call('POST', '/partner-orders', {
      apiKey: w.apiKey,
      body: { externalOrderId: 'SITE-USD', currency: 'BONUS_POINT', items: [{ name: 'x', quantity: 1, unitPrice: '1' }] },
    });
    expect(bad.status).toBe(400);
    const ok = await call('POST', '/partner-orders', {
      apiKey: w.apiKey,
      body: { externalOrderId: 'SITE-2', items: [{ name: 'x', quantity: 1, unitPrice: '1000' }] },
    });
    expect((await call('GET', `/partner-orders/${(ok.data as { id: string }).id}/checkout`)).status).toBe(401);
  });
});
