import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { DemoSessionService } from '../src/modules/auth/demo-session.service';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Signing in to a demonstration without a phone that can receive SMS.
 *
 * The property under test is narrow and the important half is negative: this
 * must be *unreachable* unless the deployment has said it is a demonstration,
 * and it must grant nothing that typing the seeded credentials into the login
 * form would not.
 */
describe('Demo sign-in (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let auth: AuthService;
  let demo: DemoSessionService;
  let config: ConfigService;

  const meta = { ip: '127.0.0.1', userAgent: 'jest' };
  const DEMO_PASSWORD = 'demo-password-long-enough';

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    auth = harness.app.get(AuthService);
    demo = harness.app.get(DemoSessionService);
    config = harness.app.get(ConfigService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
    process.env.DEMO_PASSWORD = DEMO_PASSWORD;
  });

  afterEach(() => {
    delete process.env.DEMO_PASSWORD;
  });

  /** Turns demo mode on for one test, the way a deployment's env would. */
  const withDemoMode = (on: boolean) =>
    jest.spyOn(config, 'get').mockImplementation(((key: string, ...rest: unknown[]) => {
      if (key === 'demoMode') return on;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (ConfigService.prototype.get as any).call(config, key, ...rest);
    }) as never);

  /** The customer the seeder creates, reproduced here with a known password. */
  const seedDemoCustomer = async () => {
    const { user } = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        phone: DemoSessionService.DEMO_PHONE,
        passwordHash: await argon2.hash(DEMO_PASSWORD),
        mustChangePassword: false,
      },
    });
    return user;
  };

  it('issues a session for the seeded customer when demo mode is on', async () => {
    withDemoMode(true);
    const user = await seedDemoCustomer();

    const result = await demo.createSession('device-demo-1', meta);

    expect(result.user.id).toBe(user.id);
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
  });

  it('does not exist at all when demo mode is off', async () => {
    withDemoMode(false);
    await seedDemoCustomer();

    // 404 rather than 403: a route that refuses is a route that exists, and a
    // production API should not advertise one.
    await expect(demo.createSession('device-demo-1', meta)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses when the deployment forgot to seed, and says which', async () => {
    withDemoMode(true);
    // No demo customer created.

    await expect(demo.createSession('device-demo-1', meta)).rejects.toThrow(/DEMO_SEED/);
  });

  it('refuses when DEMO_MODE is on but no password was configured', async () => {
    withDemoMode(true);
    delete process.env.DEMO_PASSWORD;
    await seedDemoCustomer();

    await expect(demo.createSession('device-demo-1', meta)).rejects.toThrow(/DEMO_PASSWORD/);
  });

  it('goes through the ordinary login, not around it', async () => {
    // The guarantee that matters: no second authentication path exists. If
    // `AuthService.login` refuses — a locked account, a rotated password, a
    // deactivated user — the demo route refuses too.
    withDemoMode(true);
    await seedDemoCustomer();
    const login = jest
      .spyOn(auth, 'login')
      .mockRejectedValue(new UnauthorizedException('Incorrect phone number or password'));

    await expect(demo.createSession('device-demo-1', meta)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: DemoSessionService.DEMO_PHONE,
        deviceId: 'device-demo-1',
      }),
      meta,
    );
  });

  it('binds the session to the caller device, like any other login', async () => {
    withDemoMode(true);
    const user = await seedDemoCustomer();

    await demo.createSession('device-demo-2', meta);

    // Sessions, refresh rotation and "log out everywhere" are all per device.
    // A demo session that skipped the device id would be the one session in
    // the system that behaves differently.
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.deviceId).toBe('device-demo-2');
  });

  it('leaves an ordinary sign-in exactly as it was', async () => {
    withDemoMode(true);
    const password = 'another-password-entirely';
    const { user } = await createCustomer(prisma);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(password), mustChangePassword: false },
    });

    const normal = await auth.login({ phone: user.phone, password, deviceId: 'device-x' }, meta);
    expect(normal.user.id).toBe(user.id);

    await expect(
      auth.login({ phone: user.phone, password: 'wrong', deviceId: 'device-x' }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
