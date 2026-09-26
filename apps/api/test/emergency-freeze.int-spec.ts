import { JwtService } from '@nestjs/jwt';
import { PrismaClient, RoleName } from '@prisma/client';
import { createCustomer, createStaffUser } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

/**
 * `EMERGENCY_FREEZE=true`, through a real Nest application with the real
 * guard chain: writes answer 503 PLATFORM_FROZEN before any controller runs,
 * reads and the operator's own routes keep working. Config reads the
 * environment at boot, so the flag is set before the harness starts and
 * restored afterwards, the way the money suites handle their own flags.
 */
describe('Emergency freeze over HTTP (e2e, real guards)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const savedFreeze = process.env.EMERGENCY_FREEZE;

  beforeAll(async () => {
    process.env.EMERGENCY_FREEZE = 'true';
    harness = await createHttpTestHarness({ authGuards: true, rbacGuards: true });
    prisma = harness.prisma;
  });

  afterAll(async () => {
    if (savedFreeze === undefined) delete process.env.EMERGENCY_FREEZE;
    else process.env.EMERGENCY_FREEZE = savedFreeze;
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const token = (user: { id: string; phone: string }) =>
    jwt.sign({ sub: user.id, phone: user.phone, deviceId: 'e2e' }, { algorithm: 'HS256', expiresIn: '10m' });

  async function call(method: string, path: string, opts: { auth?: string; body?: unknown } = {}) {
    const response = await fetch(`${harness.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const json = (await response.json().catch(() => null)) as { code?: string; data?: unknown } | null;
    return { status: response.status, body: json };
  }

  it('refuses every write with 503 PLATFORM_FROZEN, whoever is asking', async () => {
    const admin = await createStaffUser(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
    const customer = await createCustomer(prisma);

    const asAdmin = await call('POST', '/v1/partners', {
      auth: token(admin),
      body: { legalName: 'Frozen LLC', displayName: 'Frozen', category: 'cafe' },
    });
    const asCustomer = await call('POST', '/v1/qr/redeem', {
      auth: token(customer.user),
      body: { token: 'anything' },
    });
    // No token at all: the freeze answers before authentication does. (A
    // route that does not exist — e.g. the PSP callback while the provider
    // route is off — is a 404 from the router, which runs before any guard.)
    const anonymous = await call('POST', '/v1/partners', {
      body: { legalName: 'Frozen LLC', displayName: 'Frozen', category: 'cafe' },
    });

    for (const [label, result] of Object.entries({ asAdmin, asCustomer, anonymous })) {
      expect({ label, status: result.status }).toEqual({ label, status: 503 });
      expect(JSON.stringify(result.body)).toContain('PLATFORM_FROZEN');
    }
    expect(await prisma.partner.count()).toBe(0);
  });

  it('keeps reads, health and auth open', async () => {
    const customer = await createCustomer(prisma);

    const health = await call('GET', '/health');
    expect(health.status).toBe(200);

    const me = await call('GET', '/v1/users/me', { auth: token(customer.user) });
    expect(me.status).toBe(200);

    // Auth is reachable: a wrong password is answered by auth (401), not by the freeze (503).
    const login = await call('POST', '/v1/auth/login', {
      body: { phone: customer.user.phone, password: 'definitely-wrong-password', deviceId: 'e2e' },
    });
    expect(login.status).not.toBe(503);
    expect([400, 401, 429]).toContain(login.status);
  });
});
