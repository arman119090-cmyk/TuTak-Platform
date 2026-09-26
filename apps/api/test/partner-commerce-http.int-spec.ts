import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { LedgerAccountType as A, PostingDirection, PrismaClient, RoleName } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerSettlementService } from '../src/modules/partner-settlements/partner-settlement.service';
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

  const savedTopUpFlag = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;

  beforeAll(async () => {
    // Real TuTak money arrives through the real top-up flow, off by default
    // since 15.09.2026; set before boot (config reads the env at boot).
    process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = 'true';
    harness = await createHttpTestHarness({ authGuards: true, rbacGuards: true });
    prisma = harness.prisma;
  });

  afterAll(async () => {
    if (savedTopUpFlag === undefined) delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    else process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = savedTopUpFlag;
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
      [
        'appCheckoutUrl',
        'checkoutUrl',
        'currency',
        'draftExpiresAt',
        'externalOrderId',
        'id',
        'operationalStatus',
        'orderNumber',
        'paymentStatus',
        'totalAmount',
      ].sort(),
    );
    // Q12: where to send the customer — the app deep link always; the web
    // checkout link once CHECKOUT_WEB_BASE_URL is configured.
    expect((created.data as { appCheckoutUrl: string }).appCheckoutUrl).toBe(`tutak://checkout/${(created.data as { id: string }).id}`);
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
    expect((await call('POST', `/partner-orders/${orderId}/delivered`, { auth: token(w.cashier) })).status).toBe(201);

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
    expect((await call('POST', `/settlement/partners/${w.partner.id}/period`, { auth: token(w.owner), body: { periodicity: 'DAILY' } })).status).toBe(403);
    expect(
      (await call('POST', `/shifts/admin/partners/${w.partner.id}/required-from`, { auth: token(w.owner), body: { at: '2099-01-01T00:00:00Z' } })).status,
    ).toBe(403);
    expect((await call('GET', '/admin/partner-orders/queue?queue=all', { auth: token(w.owner) })).status).toBe(403);
    expect((await call('POST', '/admin/partner-orders/commission-rules', { auth: token(w.admin), body: rule })).status).toBe(201);
    expect((await call('POST', `/settlement/partners/${w.partner.id}/period`, { auth: token(w.admin), body: { periodicity: 'WEEKLY', anchorDay: 3 } })).status).toBe(201);
    const cadence = await prisma.partner.findUniqueOrThrow({ where: { id: w.partner.id } });
    expect([cadence.settlementPeriodicity, cadence.settlementAnchorDay]).toEqual(['WEEKLY', 3]);
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

  it('final fixes over HTTP: Q13 prepayment, cancellation cost review, shortfall settlement and shift access — each only for its own actor', async () => {
    const w = await world();
    const { user: manager } = await createCustomer(prisma);
    await withRole(manager.id, RoleName.PARTNER_MANAGER, w.partner.id);
    await prisma.partnerBranchStaffAssignment.create({
      data: { partnerId: w.partner.id, partnerBranchId: w.branch.id, userId: manager.id, assignedByUserId: w.admin.id, employeeDisplayCode: 'M-1' },
    });
    // Item 10: a manager manages their own shift — permissions, not a primary role.
    expect((await call('GET', `/shifts/me?partnerId=${w.partner.id}`, { auth: token(manager) })).status).toBe(200);
    expect((await call('POST', '/shifts/start', { auth: token(manager), body: { branchId: w.branch.id } })).status).toBe(201);
    expect((await call('POST', '/shifts/start', { auth: token(w.cashier), body: { branchId: w.branch.id } })).status).toBe(201);

    // Q13 over HTTP: a prepayment rule is not satisfied by the discount.
    expect(
      (
        await call('POST', '/admin/partner-orders/prepayment-rules', {
          auth: token(w.admin),
          body: { partnerId: w.partner.id, mode: 'FIXED', fixedAmount: '5000' },
        })
      ).status,
    ).toBe(201);
    const created = await call('POST', '/partner-orders', {
      apiKey: w.apiKey,
      body: {
        externalOrderId: 'SITE-FF',
        branchId: w.branch.id,
        cancellationTerms: 'The courier fee is kept once the courier left',
        items: [{ name: 'Brake pads', quantity: 1, unitPrice: '30000' }],
      },
    });
    const orderId = (created.data as { id: string }).id;
    const checkout = await call('GET', `/partner-orders/${orderId}/checkout`, { auth: token(w.customer) });
    expect((checkout.data as { cancellationTerms: string }).cancellationTerms).toMatch(/courier fee/);
    const noMoney = await call('POST', `/partner-orders/${orderId}/submit`, { auth: token(w.customer), body: { idempotencyKey: 'ff-submit-0' } });
    expect(noMoney.status).toBe(400);
    expect(noMoney.error?.code).toBe('PREPAYMENT_REQUIRED');
    expect(
      (await call('POST', `/partner-orders/${orderId}/submit`, { auth: token(w.customer), body: { tutakMoneyAmount: '5000', idempotencyKey: 'ff-submit-1' } }))
        .status,
    ).toBe(201);
    expect((await call('POST', `/partner-orders/${orderId}/confirm-stock`, { auth: token(w.cashier) })).status).toBe(201);
    expect((await call('POST', `/partner-orders/${orderId}/out-for-delivery`, { auth: token(w.cashier), body: { courierNote: 'Aram' } })).status).toBe(201);

    // Item 8: only the order's own customer may ask to cancel or withdraw.
    expect((await call('POST', `/partner-orders/${orderId}/cancel`, { auth: token(w.stranger), body: {} })).status).toBe(404);
    const asked = await call('POST', `/partner-orders/${orderId}/cancel`, { auth: token(w.customer), body: { reason: 'changed my mind' } });
    expect(asked.status).toBe(201);
    expect((asked.data as { customerStatus: string }).customerStatus).toBe('cancellation_requested');
    expect((await call('POST', `/partner-orders/${orderId}/cancel/withdraw`, { auth: token(w.stranger) })).status).toBe(404);
    // Only the order's partner may answer, and never decide.
    const claim = { amount: '2000', reason: 'Courier already dispatched', evidence: 'Invoice 77' };
    expect((await call('POST', `/partner-orders/${orderId}/cancellation/claim-cost`, { auth: token(w.foreignOwner), body: claim })).status).toBe(403);
    expect((await call('POST', `/partner-orders/${orderId}/cancellation/claim-cost`, { auth: token(w.cashier), body: claim })).status).toBe(201);
    const request = await prisma.partnerOrderCancellation.findFirstOrThrow({ where: { orderId } });
    const decision = { decision: 'REDUCE', approvedAmount: '1500', note: 'Invoice shows 1500' };
    expect((await call('POST', `/admin/partner-orders/cancellations/${request.id}/decide`, { auth: token(w.owner), body: decision })).status).toBe(403);
    expect((await call('POST', `/admin/partner-orders/cancellations/${request.id}/decide`, { auth: token(w.customer), body: decision })).status).toBe(403);
    const decided = await call('POST', `/admin/partner-orders/cancellations/${request.id}/decide`, { auth: token(w.admin), body: decision });
    expect(decided.status).toBe(201);
    expect((decided.data as { approvedCostAmount: string }).approvedCostAmount).toBe('1500');
    const cancelled = await prisma.partnerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(cancelled.operationalStatus).toBe('CANCELLED');

    // Q9 routes: only the order's partner settles/refuses; only its customer disputes.
    const second = await call('POST', '/partner-orders', {
      apiKey: w.apiKey,
      body: { externalOrderId: 'SITE-FF-2', branchId: w.branch.id, items: [{ name: 'Filter', quantity: 1, unitPrice: '20000' }] },
    });
    const secondId = (second.data as { id: string }).id;
    await call('POST', `/partner-orders/${secondId}/submit`, { auth: token(w.customer), body: { tutakMoneyAmount: '5000', idempotencyKey: 'ff-submit-2' } });
    await call('POST', `/partner-orders/${secondId}/confirm-stock`, { auth: token(w.cashier) });
    const legs = await prisma.partnerOrderPaymentLeg.findMany({ where: { orderId: secondId, type: 'EXTERNAL' } });
    await call('POST', `/partner-orders/legs/${legs[0]!.id}/confirm-external`, { auth: token(w.cashier) });
    await call('POST', `/partner-orders/${secondId}/delivered`, { auth: token(w.cashier) });
    expect((await call('POST', `/partner-orders/${secondId}/received`, { auth: token(w.customer) })).status).toBe(201);
    const ret = await call('POST', `/partner-orders/${secondId}/returns`, {
      auth: token(w.cashier),
      body: { reason: 'returned', idempotencyKey: 'ff-return-1' },
    });
    expect(ret.status).toBe(201);
    const returnId = (ret.data as { id: string }).id;
    expect((await call('POST', `/partner-orders/returns/${returnId}/settle-shortfall`, { auth: token(w.foreignOwner), body: { collectedAmount: '0' } })).status).toBe(403);
    expect((await call('POST', `/partner-orders/returns/${returnId}/settle-shortfall`, { auth: token(w.customer), body: { collectedAmount: '0' } })).status).toBe(403);
    expect((await call('POST', `/partner-orders/returns/${returnId}/dispute-shortfall`, { auth: token(w.stranger), body: { note: 'not mine' } })).status).toBe(404);
    expect((await call('GET', '/admin/partner-orders/return-reviews', { auth: token(w.owner) })).status).toBe(403);
    expect((await call('GET', '/admin/partner-orders/referral-withholdings', { auth: token(w.owner) })).status).toBe(403);
    expect((await call('GET', '/admin/partner-orders/referral-withholdings', { auth: token(w.admin) })).status).toBe(200);
  });

  /**
   * `POST admin/partner-settlements/:id/revoke-approval` — the server-side
   * state machine over HTTP (docs/PARTNER_COMMERCE.md §14): who may, what it
   * needs, from which states, and that it releases claims without drafting.
   */
  it('revoke-approval: permission, reason, and only from a provably unpaid APPROVED or FAILED settlement', async () => {
    const app = harness.app as unknown as { get<T>(t: unknown): T };
    const engine = app.get<PartnerSettlementService>(PartnerSettlementService);
    const ledger = app.get<LedgerService>(LedgerService);
    // ADMIN holds SETTLEMENT_MANAGE (the finance desk); a second person approves.
    const finance = await createStaffUser(prisma);
    await withRole(finance.id, RoleName.ADMIN);
    const checker = await createStaffUser(prisma);
    const { user: nobody } = await createCustomer(prisma); // authenticated, no role at all
    const revoke = (id: string, auth: string, body?: unknown) =>
      call('POST', `/admin/partner-settlements/${id}/revoke-approval`, { auth, body });
    const entries = (id: string) => prisma.partnerSettlementEntry.count({ where: { settlementId: id } });
    const openDrafts = (partnerId: string) =>
      prisma.partnerSettlement.count({ where: { partnerId, status: { in: ['DRAFT', 'READY'] } } });

    type Stage = 'DRAFT' | 'READY' | 'APPROVED' | 'PAYMENT_PENDING' | 'FAILED' | 'REQUIRES_RECONCILIATION' | 'FAILED_RECONCILED' | 'FAILED_RETRIED';
    /** A partner owed 30000 for one settleable posting, with its settlement advanced to `stage`. */
    async function settlementAt(stage: Stage) {
      const partner = await createPartner(prisma, { displayName: `Partner ${stage}` });
      await prisma.partnerBankAccount.create({
        data: { partnerId: partner.id, beneficiaryName: 'ООО Партнёр', accountNumber: 'AM00 2222', bankName: 'Тестбанк', createdByUserId: finance.id },
      });
      const [payable, bonus] = await Promise.all([
        ledger.accountFor({ type: A.PARTNER_PAYABLE, partnerId: partner.id }),
        ledger.accountFor({ type: A.BONUS_LIABILITY }),
      ]);
      await ledger.post({
        kind: 'partner.bonus_redemption_compensation',
        sourceType: 'PurchaseIntent',
        sourceId: `purchase-${randomUUID()}`,
        postings: [
          { accountId: bonus.id, direction: PostingDirection.DEBIT, amount: new Decimal('30000') },
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: new Decimal('30000') },
        ],
      });
      const draft = await engine.createDraft({
        partnerId: partner.id,
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 60_000),
        actorId: finance.id,
      });
      const current = () => prisma.partnerSettlement.findUniqueOrThrow({ where: { id: draft.id } });
      if (stage === 'DRAFT') return { partner, settlement: await current() };
      await engine.markReady(draft.id, { actorId: finance.id });
      if (stage === 'READY') return { partner, settlement: await current() };
      await engine.approve(draft.id, checker.id);
      if (stage === 'APPROVED') return { partner, settlement: await current() };
      await engine.markPaymentPending(draft.id, checker.id);
      if (stage === 'PAYMENT_PENDING') return { partner, settlement: await current() };
      if (stage === 'FAILED') {
        // The bank's unambiguous "no": the one FAILED that proves nothing moved.
        await engine.markFailed(draft.id, { actorId: checker.id, reason: 'IBAN closed', bankTransferReference: `B-${draft.id.slice(0, 8)}` });
        return { partner, settlement: await current() };
      }
      await engine.markRequiresReconciliation(draft.id, { actorId: checker.id, reason: 'bank timeout' });
      if (stage === 'REQUIRES_RECONCILIATION') return { partner, settlement: await current() };
      // A MONEY_MOVED reading, retracted, then two people confirm not moved: FAILED with the
      // reference left on the row — which does not count against it.
      await engine.proposeReconciliationOutcome(draft.id, { actorId: finance.id, outcome: 'MONEY_MOVED', evidence: 'line 3', bankTransferReference: `M-${draft.id.slice(0, 8)}` });
      await engine.proposeReconciliationOutcome(draft.id, { actorId: finance.id, outcome: 'MONEY_DID_NOT_MOVE', evidence: 'line 3 was another partner' });
      await engine.confirmReconciliationOutcome(draft.id, { actorId: checker.id });
      if (stage === 'FAILED_RECONCILED') return { partner, settlement: await current() };
      // A retry after that confirmation, bounced: the confirmation says nothing about it.
      await engine.markPaymentPending(draft.id, checker.id);
      await engine.markFailed(draft.id, { actorId: checker.id, reason: 'IBAN closed', bankTransferReference: `R-${draft.id.slice(0, 8)}` });
      return { partner, settlement: await current() };
    }

    // Permission: SETTLEMENT_MANAGE is required. The integration seed grants
    // every role every permission (test/setup/global-setup.ts), so a partner
    // owner passes the guard *here*; which roles hold SETTLEMENT_MANAGE in
    // production — ADMIN and SUPER_ADMIN, never a partner-side role — is
    // asserted in src/scripts/money-permissions.spec.ts. What HTTP can prove
    // is that the guard is on: no token → 401, a user with no role → 403.
    const approved = await settlementAt('APPROVED');
    expect((await call('POST', `/admin/partner-settlements/${approved.settlement.id}/revoke-approval`, { body: { reason: 'x'.repeat(10) } })).status).toBe(401);
    expect((await revoke(approved.settlement.id, token(nobody), { reason: 'dispute decided for the customer' })).status).toBe(403);
    // A reason is mandatory, 3-500 characters.
    expect((await revoke(approved.settlement.id, token(finance), {})).status).toBe(400);
    expect((await revoke(approved.settlement.id, token(finance), { reason: 'no' })).status).toBe(400);
    expect((await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: approved.settlement.id } })).status).toBe('APPROVED');
    expect(await entries(approved.settlement.id)).toBe(1);

    // Nothing approved yet: cancel is the tool, and the claims stay for it.
    for (const stage of ['DRAFT', 'READY'] as const) {
      const { settlement } = await settlementAt(stage);
      const r = await revoke(settlement.id, token(finance), { reason: 'why not' });
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.error)).toMatch(/cancel this settlement instead/);
      expect(await entries(settlement.id)).toBe(1);
    }

    // A transfer may have moved money: never, and nothing changes.
    for (const stage of ['PAYMENT_PENDING', 'REQUIRES_RECONCILIATION', 'FAILED_RETRIED'] as const) {
      const { settlement } = await settlementAt(stage);
      const r = await revoke(settlement.id, token(finance), { reason: 'dispute decided for the customer' });
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.error)).toMatch(/TRANSFER_MAY_HAVE_STARTED/);
      const after = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
      expect(after.status).toBe(settlement.status);
      expect(await entries(settlement.id)).toBe(1);
    }

    // Provably unpaid — APPROVED untouched, FAILED on the bank's unambiguous "no", or FAILED by a
    // confirmed MONEY_DID_NOT_MOVE: revoked, claims released, no draft made; a second call is refused
    // and changes nothing.
    for (const stage of ['APPROVED', 'FAILED', 'FAILED_RECONCILED'] as const) {
      const { partner, settlement } = await settlementAt(stage);
      const r = await revoke(settlement.id, token(finance), { reason: 'dispute decided for the customer' });
      expect(r.status).toBe(201);
      expect(r.data).toMatchObject({ id: settlement.id, status: 'CANCELLED', approvedByUserId: checker.id });
      expect(await entries(settlement.id)).toBe(0);
      expect((await engine.unsettled(partner.id)).net.toFixed(4)).toBe('30000.0000');
      expect(await openDrafts(partner.id)).toBe(0);
      const again = await revoke(settlement.id, token(finance), { reason: 'dispute decided for the customer' });
      expect(again.status).toBe(409);
      expect(JSON.stringify(again.error)).toMatch(/ALREADY_CANCELLED/);
      expect((await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: settlement.id } })).status).toBe('CANCELLED');
      expect(await openDrafts(partner.id)).toBe(0);
    }
  });
});
