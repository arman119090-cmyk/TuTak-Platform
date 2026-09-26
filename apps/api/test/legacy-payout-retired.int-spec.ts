import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, RoleName } from '@prisma/client';
import { createPartner, createStaffUser } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

/**
 * The legacy payout routes are gone from the wire, not merely disabled.
 *
 * `POST /payouts`, `POST /payouts/:id/confirm` and `POST /payouts/:id/fail`
 * were the retired payout engine's surface (Launch Readiness 26.09.2026,
 * P1). A route that is merely gated can be reached by whoever holds the
 * permission, and `PAYOUT_MANAGE` still exists for the routes that record
 * money arriving — so the check here is that the most privileged caller the
 * platform has gets a 404, same as anybody else. Real Nest application,
 * real guards: a unit test of the controller class cannot see a route that
 * is not there.
 */
describe('Legacy payout routes are retired (e2e, real auth guards)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

  beforeAll(async () => {
    harness = await createHttpTestHarness({ authGuards: true, rbacGuards: true });
    prisma = harness.prisma;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const token = (user: { id: string; phone: string }) =>
    jwt.sign({ sub: user.id, phone: user.phone, deviceId: 'e2e' }, { algorithm: 'HS256', expiresIn: '10m' });

  async function call(method: string, path: string, opts: { auth?: string; body?: unknown } = {}) {
    const response = await fetch(`${harness.baseUrl}/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const json = (await response.json().catch(() => null)) as { data?: unknown } | null;
    return { status: response.status, data: json?.data as never };
  }

  async function superAdmin() {
    const user = await createStaffUser(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return user;
  }

  it('answers 404 to every retired write route, even for SUPER_ADMIN', async () => {
    const admin = await superAdmin();
    const partner = await createPartner(prisma);
    const auth = token(admin);
    const id = randomUUID();

    const request = await call('POST', '/payouts', {
      auth,
      body: { partnerId: partner.id, amount: '1000', idempotencyKey: 'legacy-request-1' },
    });
    const confirm = await call('POST', `/payouts/${id}/confirm`, { auth, body: { bankReference: 'BANK-1' } });
    const fail = await call('POST', `/payouts/${id}/fail`, { auth, body: { failureReason: 'account closed' } });

    expect([request.status, confirm.status, fail.status]).toEqual([404, 404, 404]);
    expect(await prisma.payout.count()).toBe(0);
    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });

  it('keeps the reads: the balance and the historical rows are still served', async () => {
    const admin = await superAdmin();
    const partner = await createPartner(prisma);
    const auth = token(admin);

    const balance = await call('GET', `/payouts/partners/${partner.id}/balance`, { auth });
    expect(balance.status).toBe(200);
    expect(balance.data).toEqual({ partnerId: partner.id, availableBalance: '0.0000', currency: 'AMD' });

    const rows = await call('GET', `/payouts/partners/${partner.id}`, { auth });
    expect(rows.status).toBe(200);
    expect(rows.data).toEqual([]);
  });
});
