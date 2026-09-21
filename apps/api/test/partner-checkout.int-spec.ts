import { JwtService } from '@nestjs/jwt';
import {
  BonusEntryType,
  LedgerAccountType,
  PartnerCheckoutStatus,
  PartnerIntegrationStatus,
  PartnerIntegrationType,
  PrismaClient,
  PurchaseIntentStatus,
  RoleName,
  User,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PartnerCheckoutService } from '../src/modules/partner-checkout/partner-checkout.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PartnerApiKeyService } from '../src/modules/roaming-cpo/partner-api-key.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer, createPartner, fundPrepaidBalance } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

/**
 * The POS front door (brief §20–21, §38, §40): a till opens a purchase
 * under its own M2M credential, the customer claims it by scanning, and
 * from there it is the ordinary engine. The last describe is the brief's
 * own acceptance: a checkout and a scan with identical inputs produce
 * identical ledgers.
 */
describe('Partner checkouts — POS seam (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let apiKeys: PartnerApiKeyService;
  let checkouts: PartnerCheckoutService;
  let purchaseIntents: PurchaseIntentsService;
  let ledger: LedgerService;
  let engine: BonusEngineService;

  beforeAll(async () => {
    harness = await createHttpTestHarness({ authGuards: true });
    prisma = harness.prisma;
    jwt = harness.app.get(JwtService);
    apiKeys = harness.app.get(PartnerApiKeyService);
    checkouts = harness.app.get(PartnerCheckoutService);
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    ledger = harness.app.get(LedgerService);
    engine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(prisma);
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** A partner with an ACTIVE POS integration and one M2M key issued for it. */
  const posPartner = async (branchId?: string) => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
    const integration = await prisma.partnerIntegration.create({
      data: {
        partnerId: partner.id,
        type: PartnerIntegrationType.POS,
        status: PartnerIntegrationStatus.ACTIVE,
        partnerBranchId: branchId ?? null,
      },
    });
    const key = await apiKeys.issue({ partnerId: partner.id, integrationId: integration.id, label: 'till-1' });
    return { partner, integration, apiKey: key.apiKey, apiKeyId: key.id };
  };

  const tokenFor = (user: User) =>
    jwt.signAsync({ sub: user.id, phone: user.phone, deviceId: 'device-pos' }, { expiresIn: '15m' });

  const pos = async (apiKey: string, method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await fetch(`${harness.baseUrl}/v1/partner-checkouts${path}`, {
      method,
      headers: { 'x-api-key': apiKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as { data?: Record<string, unknown>; message?: string }) : {};
    return { status: res.status, data: (parsed.data ?? {}) as Record<string, unknown>, message: parsed.message };
  };

  const customerApi = async (user: User, method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await fetch(`${harness.baseUrl}/v1/partner-checkouts${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await tokenFor(user)}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as { data?: Record<string, unknown> }) : {};
    return { status: res.status, data: (parsed.data ?? {}) as Record<string, unknown> };
  };

  const customer = async (bonus: string, money: string) => {
    const { user, wallet } = await createCustomer(prisma);
    if (new Decimal(bonus).greaterThan(0)) {
      await engine.accrue({ walletId: wallet.id, type: BonusEntryType.ACCRUAL_PURCHASE, amount: bonus, pendingHours: 0 });
    }
    if (new Decimal(money).greaterThan(0)) await fundPrepaidBalance(ledger, user.id, money);
    return user;
  };

  const payablePostings = async (partnerId: string) => {
    const postings = await prisma.ledgerPosting.findMany({
      where: { account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId } },
      select: { amount: true, direction: true, transaction: { select: { kind: true } } },
      orderBy: { transaction: { postedAt: 'asc' } },
    });
    return postings.map((p) => `${p.transaction.kind}:${p.direction}:${p.amount.toFixed(4)}`);
  };

  // ── §38: auth, idempotency, uniqueness, scope ────────────────────────────

  describe('the till side (M2M)', () => {
    it('opens a checkout under a valid key and returns an opaque token for the QR', async () => {
      const { apiKey } = await posPartner();
      const res = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-1', grossAmount: '50000' });
      expect(res.status).toBe(201);
      expect(res.data).toMatchObject({ status: 'OPEN', externalReference: 'RCPT-1', grossAmount: '50000.0000' });
      expect(String(res.data.qrPayload)).toMatch(/^tutak:\/\/checkout\/[A-Za-z0-9_-]{20,}$/);
      // Nothing about the customer, nothing computed: the token is all the QR carries.
      expect(res.data.purchase).toBeNull();
    });

    it('refuses without a key, with a bad key, and with a revoked key', async () => {
      const { partner, apiKey, apiKeyId } = await posPartner();
      const body = { externalReference: 'RCPT-2', grossAmount: '1000' };
      expect((await pos('', 'POST', '', body)).status).toBe(401);
      expect((await pos('nope.nope', 'POST', '', body)).status).toBe(401);
      await apiKeys.revoke(apiKeyId, partner.id);
      expect((await pos(apiKey, 'POST', '', body)).status).toBe(401);
    });

    it('refuses a partner whose POS integration is not active, key or no key', async () => {
      const partner = await createPartner(prisma);
      const key = await apiKeys.issue({ partnerId: partner.id });
      const res = await pos(key.apiKey, 'POST', '', { externalReference: 'RCPT-3', grossAmount: '1000' });
      expect(res.status).toBe(403);
      expect(await prisma.partnerCheckout.count()).toBe(0);
    });

    // ── Audit 21.09.2026, D17: a key is a credential for one integration ──

    it('D17: a partner-wide key, a roaming-CPO key and a key on a suspended integration open nothing', async () => {
      const { partner, integration, apiKey } = await posPartner();
      const partnerWide = await apiKeys.issue({ partnerId: partner.id, label: 'no integration' });
      expect((await pos(partnerWide.apiKey, 'POST', '', { externalReference: 'R-A', grossAmount: '1000' })).status).toBe(403);

      const roaming = await prisma.partnerIntegration.create({
        data: { partnerId: partner.id, type: PartnerIntegrationType.API, status: PartnerIntegrationStatus.ACTIVE },
      });
      const roamingKey = await apiKeys.issue({ partnerId: partner.id, integrationId: roaming.id });
      expect((await pos(roamingKey.apiKey, 'POST', '', { externalReference: 'R-B', grossAmount: '1000' })).status).toBe(403);

      const created = await pos(apiKey, 'POST', '', { externalReference: 'R-C', grossAmount: '1000' });
      expect(created.status).toBe(201);
      // Suspending the integration takes effect on the very next request —
      // status, cancel and confirm included, not only create.
      await prisma.partnerIntegration.update({ where: { id: integration.id }, data: { status: PartnerIntegrationStatus.SUSPENDED } });
      expect((await pos(apiKey, 'POST', '', { externalReference: 'R-D', grossAmount: '1000' })).status).toBe(403);
      expect((await pos(apiKey, 'GET', `/${created.data.checkoutId}`)).status).toBe(403);
      expect((await pos(apiKey, 'POST', `/${created.data.checkoutId}/confirm`)).status).toBe(403);
      expect(await prisma.partnerCheckout.count()).toBe(1);
    });

    it('D17: a key scoped to a branch sells at that branch only, and defaults to it', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
      const branch = (name: string) =>
        prisma.partnerBranch.create({ data: { partnerId: partner.id, name, address: name, city: 'Yerevan', latitude: 40.18, longitude: 44.51, isActive: true } });
      const north = await branch('North');
      const south = await branch('South');
      const integration = await prisma.partnerIntegration.create({
        data: { partnerId: partner.id, type: PartnerIntegrationType.POS, status: PartnerIntegrationStatus.ACTIVE, partnerBranchId: north.id },
      });
      const key = await apiKeys.issue({ partnerId: partner.id, integrationId: integration.id });

      const elsewhere = await pos(key.apiKey, 'POST', '', { externalReference: 'R-N1', grossAmount: '1000', partnerBranchId: south.id });
      expect(elsewhere.status).toBe(403);
      const defaulted = await pos(key.apiKey, 'POST', '', { externalReference: 'R-N2', grossAmount: '1000' });
      expect(defaulted.status).toBe(201);
      const row = await prisma.partnerCheckout.findUniqueOrThrow({ where: { id: String(defaulted.data.checkoutId) } });
      expect(row.partnerBranchId).toBe(north.id);
      const explicit = await pos(key.apiKey, 'POST', '', { externalReference: 'R-N3', grossAmount: '1000', partnerBranchId: north.id });
      expect(explicit.status).toBe(201);
    });

    it('D17: two integrations at one partner do not see each other\'s checkouts', async () => {
      const a = await posPartner();
      const secondIntegration = await prisma.partnerIntegration.create({
        data: { partnerId: a.partner.id, type: PartnerIntegrationType.POS, status: PartnerIntegrationStatus.ACTIVE },
      });
      const b = await apiKeys.issue({ partnerId: a.partner.id, integrationId: secondIntegration.id });
      const created = await pos(a.apiKey, 'POST', '', { externalReference: 'R-X', grossAmount: '1000' });
      const id = String(created.data.checkoutId);
      expect((await pos(b.apiKey, 'GET', `/${id}`)).status).toBe(404);
      expect((await pos(b.apiKey, 'POST', `/${id}/cancel`)).status).toBe(404);
      expect((await pos(b.apiKey, 'POST', `/${id}/confirm`)).status).toBe(404);
      expect((await pos(a.apiKey, 'GET', `/${id}`)).status).toBe(200);
    });

    // ── Audit 21.09.2026, D11: the idempotency fingerprint is every semantic input ──

    it('D11: the same key with a changed branch, line item or timestamp is a conflict, never a silent replay', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
      const branch = (name: string) =>
        prisma.partnerBranch.create({ data: { partnerId: partner.id, name, address: name, city: 'Yerevan', latitude: 40.18, longitude: 44.51, isActive: true } });
      const east = await branch('East');
      const west = await branch('West');
      const integration = await prisma.partnerIntegration.create({
        data: { partnerId: partner.id, type: PartnerIntegrationType.POS, status: PartnerIntegrationStatus.ACTIVE },
      });
      const key = await apiKeys.issue({ partnerId: partner.id, integrationId: integration.id });
      const base = {
        externalReference: 'RCPT-D11',
        grossAmount: '15000',
        partnerBranchId: east.id,
        quantity: '50',
        quantityUnit: 'LITER',
        unitPrice: '300',
        occurredAt: '2026-09-21T10:00:00.000Z',
        idempotencyKey: 'same-key',
      };
      const first = await pos(key.apiKey, 'POST', '', base);
      expect(first.status).toBe(201);
      const replay = await pos(key.apiKey, 'POST', '', base);
      expect(replay.status).toBe(201);
      expect(replay.data.checkoutId).toBe(first.data.checkoutId);

      expect((await pos(key.apiKey, 'POST', '', { ...base, partnerBranchId: west.id })).status).toBe(409);
      expect((await pos(key.apiKey, 'POST', '', { ...base, quantity: '30', unitPrice: '500' })).status).toBe(409);
      expect((await pos(key.apiKey, 'POST', '', { ...base, occurredAt: '2026-09-21T11:00:00.000Z' })).status).toBe(409);
      expect(await prisma.partnerCheckout.count()).toBe(1);
    });

    it('never opens the same receipt twice: external reference is unique per partner, and an idempotency key replays', async () => {
      const { apiKey } = await posPartner();
      const first = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-4', grossAmount: '1000', idempotencyKey: 'k1' });
      const replay = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-4', grossAmount: '1000', idempotencyKey: 'k1' });
      expect(replay.status).toBe(201);
      expect(replay.data.checkoutId).toBe(first.data.checkoutId);
      expect(replay.data.token).toBe(first.data.token);

      const dup = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-4', grossAmount: '1000' });
      expect(dup.status).toBe(409);
      const conflict = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-5', grossAmount: '2000', idempotencyKey: 'k1' });
      expect(conflict.status).toBe(409);
      expect(await prisma.partnerCheckout.count()).toBe(1);
      // A different partner may reuse the same receipt number.
      const other = await posPartner();
      expect((await pos(other.apiKey, 'POST', '', { externalReference: 'RCPT-4', grossAmount: '1000' })).status).toBe(201);
    });

    it('scopes status, cancel and confirm to the key\'s own partner', async () => {
      const a = await posPartner();
      const b = await posPartner();
      const created = await pos(a.apiKey, 'POST', '', { externalReference: 'RCPT-6', grossAmount: '1000' });
      const id = String(created.data.checkoutId);
      expect((await pos(b.apiKey, 'GET', `/${id}`)).status).toBe(404);
      expect((await pos(b.apiKey, 'POST', `/${id}/cancel`)).status).toBe(404);
      expect((await pos(b.apiKey, 'POST', `/${id}/confirm`)).status).toBe(404);
      expect((await pos(a.apiKey, 'GET', `/${id}`)).status).toBe(200);
    });

    it('refuses a line item that does not multiply to the gross, and a non-positive gross', async () => {
      const { apiKey } = await posPartner();
      expect(
        (await pos(apiKey, 'POST', '', { externalReference: 'R', grossAmount: '15000', quantity: '50', quantityUnit: 'LITER', unitPrice: '299' })).status,
      ).toBe(400);
      expect((await pos(apiKey, 'POST', '', { externalReference: 'R2', grossAmount: '0' })).status).toBe(400);
      expect((await pos(apiKey, 'POST', '', { externalReference: 'R3', grossAmount: '-5' })).status).toBe(400);
    });

    it('cancels an unclaimed checkout, and refuses to cancel a claimed one', async () => {
      const { apiKey } = await posPartner();
      const user = await customer('0', '0');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-7', grossAmount: '1000' });
      const cancelled = await pos(apiKey, 'POST', `/${created.data.checkoutId}/cancel`);
      expect(cancelled.data.status).toBe('CANCELLED');
      expect((await customerApi(user, 'POST', `/claim/${created.data.token}`, {})).status).toBe(409);

      const second = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-8', grossAmount: '1000' });
      expect((await customerApi(user, 'POST', `/claim/${second.data.token}`, {})).status).toBe(201);
      expect((await pos(apiKey, 'POST', `/${second.data.checkoutId}/cancel`)).status).toBe(409);
    });

    it('expires an unscanned checkout and refuses the claim afterwards', async () => {
      const { apiKey } = await posPartner();
      const user = await customer('0', '0');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-9', grossAmount: '1000' });
      await prisma.partnerCheckout.update({
        where: { id: String(created.data.checkoutId) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await customerApi(user, 'GET', `/resolve/${created.data.token}`)).status).toBe(410);
      expect((await customerApi(user, 'POST', `/claim/${created.data.token}`, {})).status).toBe(410);
      expect(await checkouts.expireStale()).toBe(1);
      expect((await pos(apiKey, 'GET', `/${created.data.checkoutId}`)).data.status).toBe('EXPIRED');
    });
  });

  // ── §21: the customer's side ────────────────────────────────────────────

  describe('the customer side', () => {
    it('resolves a token to who is selling and for how much — nothing about balances', async () => {
      const { partner, apiKey } = await posPartner();
      const user = await customer('0', '0');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-10', grossAmount: '50000' });
      const res = await customerApi(user, 'GET', `/resolve/${created.data.token}`);
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({
        partnerId: partner.id,
        partnerDisplayName: partner.displayName,
        grossAmount: '50000.0000',
        status: 'OPEN',
      });
      expect(Object.keys(res.data)).not.toEqual(expect.arrayContaining(['availablePrepaidBalance', 'availableBonus']));
      // Unauthenticated scans learn nothing.
      const anon = await fetch(`${harness.baseUrl}/v1/partner-checkouts/resolve/${created.data.token}`);
      expect(anon.status).toBe(401);
    });

    it('claims with a funding choice, and the purchase is the ordinary engine\'s', async () => {
      const { partner, apiKey } = await posPartner();
      const user = await customer('5000', '20000');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-11', grossAmount: '50000' });

      const claim = await customerApi(user, 'POST', `/claim/${created.data.token}`, {
        bonusAmountRequested: '5000',
        prepaidAmountApplied: '20000',
      });
      expect(claim.status).toBe(201);
      expect(claim.data).toMatchObject({
        partnerId: partner.id,
        status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
        grossAmount: '50000',
        bonusAmountRequested: '5000',
        prepaidAmountApplied: '20000',
        ordinaryPaymentRemainder: '25000',
      });
      // The gross is the till's, not the client's: nothing in the claim body can change it.
      const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: String(claim.data.id) } });
      expect(row.grossAmount.toFixed(4)).toBe('50000.0000');

      // The till now sees the server's collect figure.
      const status = await pos(apiKey, 'GET', `/${created.data.checkoutId}`);
      expect(status.data.status).toBe('CLAIMED');
      expect(status.data.purchase).toMatchObject({
        status: 'AWAITING_CONFIRMATION',
        externalAmountDue: '25000.0000',
        prepaidAmountApplied: '20000.0000',
      });
    });

    it('two customers scanning one screen: exactly one owns the checkout; the same customer\'s retry is idempotent', async () => {
      const { apiKey } = await posPartner();
      const [alice, bob] = await Promise.all([customer('0', '0'), customer('0', '0')]);
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-12', grossAmount: '1000' });

      const results = await Promise.all([
        customerApi(alice, 'POST', `/claim/${created.data.token}`, {}),
        customerApi(bob, 'POST', `/claim/${created.data.token}`, {}),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const winner = results.find((r) => r.status === 201)!;
      const owner = String(winner.data.customerId) === alice.id ? alice : bob;
      const retry = await customerApi(owner, 'POST', `/claim/${created.data.token}`, {});
      expect(retry.status).toBe(201);
      expect(retry.data.id).toBe(winner.data.id);
      expect(await prisma.purchaseIntent.count()).toBe(1);
    });

    // ── Audit 21.09.2026, D10: the purchase and its binding commit together ──

    it('D10: a failure after the purchase is inserted but before the checkout names it rolls the purchase back — nobody else can claim a sale that has a live purchase', async () => {
      const { apiKey } = await posPartner();
      const [alice, bob] = await Promise.all([customer('5000', '0'), customer('0', '0')]);
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-D10', grossAmount: '10000' });

      // The binding runs inside the insert's transaction; making it fail is
      // the auditor's "injected link error after purchase commit" — except
      // that the purchase now cannot commit without it.
      const spy = jest
        .spyOn(checkouts as unknown as { bindCheckoutToPurchase: () => Promise<void> }, 'bindCheckoutToPurchase')
        .mockRejectedValueOnce(new Error('injected link error'));
      const failed = await customerApi(alice, 'POST', `/claim/${created.data.token}`, { bonusAmountRequested: '5000' });
      spy.mockRestore();
      expect(failed.status).toBeGreaterThanOrEqual(500);

      // Nothing half-open: no purchase, no bonus held, the code handed back.
      expect(await prisma.purchaseIntent.count()).toBe(0);
      const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: alice.id } });
      expect(wallet.reservedBonus.toFixed(4)).toBe('0.0000');
      const row = await prisma.partnerCheckout.findUniqueOrThrow({ where: { id: String(created.data.checkoutId) } });
      expect(row.status).toBe(PartnerCheckoutStatus.OPEN);
      expect(row.purchaseIntentId).toBeNull();

      // The sale is still real and exactly one customer gets it.
      const bobs = await customerApi(bob, 'POST', `/claim/${created.data.token}`, {});
      expect(bobs.status).toBe(201);
      expect((await customerApi(alice, 'POST', `/claim/${created.data.token}`, {})).status).toBe(409);
      expect(await prisma.purchaseIntent.count()).toBe(1);
      const bound = await prisma.partnerCheckout.findUniqueOrThrow({ where: { id: String(created.data.checkoutId) } });
      expect(bound.purchaseIntentId).toBe(String(bobs.data.id));
    });

    it('D10: the till cancelling in the window between claim and insert rolls the purchase back', async () => {
      const { apiKey } = await posPartner();
      const alice = await customer('0', '0');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-D10b', grossAmount: '10000' });
      // Between the claim flip and the insert, the checkout is expired
      // underneath the customer (the sweep's own transition).
      const realCreate = purchaseIntents.create.bind(purchaseIntents);
      const spy = jest.spyOn(purchaseIntents, 'create').mockImplementation(async (dto, customerId, opts) => {
        await prisma.partnerCheckout.update({
          where: { id: String(created.data.checkoutId) },
          data: { status: PartnerCheckoutStatus.EXPIRED, claimedByUserId: null, claimedAt: null },
        });
        return realCreate(dto, customerId, opts);
      });
      const res = await customerApi(alice, 'POST', `/claim/${created.data.token}`, {});
      spy.mockRestore();
      expect(res.status).toBe(409);
      expect(await prisma.purchaseIntent.count()).toBe(0);
    });

    it('D11: a replayed claim with a different funding choice is a conflict; the same choice is the same purchase', async () => {
      const { apiKey } = await posPartner();
      const user = await customer('5000', '20000');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-D11c', grossAmount: '50000' });
      const first = await customerApi(user, 'POST', `/claim/${created.data.token}`, { bonusAmountRequested: '5000', prepaidAmountApplied: '20000' });
      expect(first.status).toBe(201);
      const same = await customerApi(user, 'POST', `/claim/${created.data.token}`, { bonusAmountRequested: '5000', prepaidAmountApplied: '20000' });
      expect(same.status).toBe(201);
      expect(same.data.id).toBe(first.data.id);
      const bare = await customerApi(user, 'POST', `/claim/${created.data.token}`, {});
      expect(bare.status).toBe(201); // asks for nothing in particular: the purchase as it is
      const different = await customerApi(user, 'POST', `/claim/${created.data.token}`, { bonusAmountRequested: '0', prepaidAmountApplied: '0' });
      expect(different.status).toBe(409);
      expect(await prisma.purchaseIntent.count()).toBe(1);
    });

    it('hands the code back when the purchase cannot be funded, so the till need not reprint', async () => {
      const { apiKey } = await posPartner();
      const user = await customer('0', '1000');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-13', grossAmount: '5000' });
      const failed = await customerApi(user, 'POST', `/claim/${created.data.token}`, { prepaidAmountApplied: '5000' });
      expect(failed.status).toBe(400);
      const row = await prisma.partnerCheckout.findUniqueOrThrow({ where: { id: String(created.data.checkoutId) } });
      expect(row.status).toBe(PartnerCheckoutStatus.OPEN);
      expect(row.claimedByUserId).toBeNull();
      const ok = await customerApi(user, 'POST', `/claim/${created.data.token}`, { prepaidAmountApplied: '1000' });
      expect(ok.status).toBe(201);
    });
  });

  // ── §20: the till confirms; §40: same economics as a scan ───────────────

  describe('confirmation by the till', () => {
    it('finalises the purchase under the API key — approval names the key, settlement is the engine\'s', async () => {
      const { partner, apiKey, apiKeyId } = await posPartner();
      const user = await customer('5000', '20000');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-14', grossAmount: '50000' });
      await customerApi(user, 'POST', `/claim/${created.data.token}`, { bonusAmountRequested: '5000', prepaidAmountApplied: '20000' });

      expect((await pos(apiKey, 'POST', `/${created.data.checkoutId}/confirm`)).data.purchase).toMatchObject({
        status: 'CONFIRMED',
        externalAmountDue: '25000.0000',
      });
      const intent = await prisma.purchaseIntent.findFirstOrThrow({ where: { partnerId: partner.id } });
      expect(intent.merchantApprovedByApiKeyId).toBe(apiKeyId);
      expect(intent.merchantApprovedByUserId).toBeNull();
      expect(intent.confirmedByUserId).toBeNull();
      expect(await payablePostings(partner.id)).toEqual([
        'partner.contribution:DEBIT:2500.0000',
        'partner.bonus_redemption_compensation:CREDIT:5000.0000',
        'partner.prepaid_funding:CREDIT:20000.0000',
      ]);
      // Replay-safe: a second confirm is the same answer, not a second settlement.
      expect((await pos(apiKey, 'POST', `/${created.data.checkoutId}/confirm`)).status).toBe(201);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'partner.contribution' } })).toBe(1);
    });

    it('refuses to confirm before anyone claimed', async () => {
      const { apiKey } = await posPartner();
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-15', grossAmount: '1000' });
      expect((await pos(apiKey, 'POST', `/${created.data.checkoutId}/confirm`)).status).toBe(409);
    });

    it('§40: a checkout and a branch-QR scan with identical inputs produce identical ledgers', async () => {
      const { partner, apiKey } = await posPartner();
      const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
      const staff = await customer('0', '0');
      await prisma.userRole.create({ data: { userId: staff.id, roleId: role.id, partnerId: partner.id } });

      // Path 1 — the QR flow: the customer types the gross, the cashier confirms.
      const viaQr = await customer('5000', '20000');
      const qrIntent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '50000', bonusAmountRequested: '5000', prepaidAmountApplied: '20000' },
        viaQr.id,
      );
      await purchaseIntents.confirm(qrIntent.id, staff.id);
      const afterQr = await payablePostings(partner.id);

      // Path 2 — the POS flow: the till states the gross, the customer claims, the till confirms.
      const viaPos = await customer('5000', '20000');
      const created = await pos(apiKey, 'POST', '', { externalReference: 'RCPT-16', grossAmount: '50000' });
      const claim = await customerApi(viaPos, 'POST', `/claim/${created.data.token}`, { bonusAmountRequested: '5000', prepaidAmountApplied: '20000' });
      await pos(apiKey, 'POST', `/${created.data.checkoutId}/confirm`);
      const afterPos = (await payablePostings(partner.id)).slice(afterQr.length);

      expect(afterPos).toEqual(afterQr);
      const [a, b] = await Promise.all([
        prisma.purchaseIntent.findUniqueOrThrow({ where: { id: qrIntent.id } }),
        prisma.purchaseIntent.findUniqueOrThrow({ where: { id: String(claim.data.id) } }),
      ]);
      for (const key of ['poolAmount', 'greenAmount', 'deferredAmount', 'tutakAmount', 'ordinaryPaymentRemainder', 'prepaidAmountApplied'] as const) {
        expect(b[key]!.toFixed(4)).toBe(a[key]!.toFixed(4));
      }
    });
  });
});
