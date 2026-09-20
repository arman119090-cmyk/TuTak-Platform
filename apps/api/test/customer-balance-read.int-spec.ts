import { JwtService } from '@nestjs/jwt';
import { PrismaClient, User } from '@prisma/client';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, fundPrepaidBalance } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

/**
 * The state the hybrid pilot runs in (owner's brief §18, 20.09.2026):
 * purchases may spend a stored balance, nobody may pay into one yet. The
 * customer must be able to see their money — available, reserved, book —
 * while every top-up route stays a 404, not a refusal.
 */
describe('Customer balance: readable when purchases may spend it, top-ups closed (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let ledger: LedgerService;

  const savedTopUp = process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
  const savedPurchase = process.env.CUSTOMER_PREPAID_PURCHASE_ENABLED;

  beforeAll(async () => {
    delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    process.env.CUSTOMER_PREPAID_PURCHASE_ENABLED = 'true';
    harness = await createHttpTestHarness({ authGuards: true });
    prisma = harness.prisma;
    jwt = harness.app.get(JwtService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    if (savedTopUp === undefined) delete process.env.CUSTOMER_PREPAID_TOPUP_ENABLED;
    else process.env.CUSTOMER_PREPAID_TOPUP_ENABLED = savedTopUp;
    if (savedPurchase === undefined) delete process.env.CUSTOMER_PREPAID_PURCHASE_ENABLED;
    else process.env.CUSTOMER_PREPAID_PURCHASE_ENABLED = savedPurchase;
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const tokenFor = (user: User) =>
    jwt.signAsync({ sub: user.id, phone: user.phone, deviceId: 'device-balance' }, { expiresIn: '15m' });

  const get = async (user: User, path: string) => {
    const res = await fetch(`${harness.baseUrl}/v1${path}`, {
      headers: { authorization: `Bearer ${await tokenFor(user)}` },
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as { data?: Record<string, unknown> }) : {} };
  };

  it('reads available, reserved and book, and says which capabilities are on', async () => {
    const { user } = await createCustomer(prisma);
    await fundPrepaidBalance(ledger, user.id, '12500');

    const res = await get(user, '/balance/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      available: '12500.0000',
      reserved: '0.0000',
      book: '12500.0000',
      balance: '12500.0000',
      currency: 'AMD',
      purchasesEnabled: true,
      topUpsEnabled: false,
    });
  });

  it('has no top-up routes at all', async () => {
    const { user } = await createCustomer(prisma);
    expect((await get(user, '/balance/topup/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    const post = await fetch(`${harness.baseUrl}/v1/balance/topup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokenFor(user)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: '5000' }),
    });
    expect(post.status).toBe(404);
    const webhook = await fetch(`${harness.baseUrl}/v1/balance/topup/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerReference: 'x', outcome: 'COMPLETED' }),
    });
    expect(webhook.status).toBe(404);
  });
});
