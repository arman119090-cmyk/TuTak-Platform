import type { INestApplicationContext } from '@nestjs/common';
import type { NestFactory as NestFactoryType } from '@nestjs/core';

/**
 * The canonical TuTak model never charges the customer's card — the
 * customer pays the partner directly, outside TuTak — so a canonical
 * production deployment has no acquirer relationship to configure. Before
 * this test existed, `PaymentsModule` (the legacy card-payment/PSP
 * subsystem: `/payments`, `/refunds`) was imported unconditionally in
 * `AppModule`, and its own provider factory refuses to boot
 * `NODE_ENV=production` without either a real acquirer or `DEMO_MODE=true`
 * — meaning canonical production, which needs neither, could not start at
 * all. See GitHub issue #28, CARD_PAYMENTS_ENABLED in app.module.ts.
 *
 * `AppModule`'s `imports` array decides membership with a module-level
 * `const` read from `process.env` once, at import time (decorator metadata
 * is static — it is evaluated before Nest's DI container, and therefore
 * `ConfigService`, exist). Proving both directions of that gate means
 * re-importing the module fresh under each env combination — and
 * `jest.resetModules()` has to take `@nestjs/core` itself along for the
 * ride: Nest's DI relies on singleton identity for tokens like `ModuleRef`,
 * so booting a freshly-reset `AppModule` with the `NestFactory` imported at
 * the top of this file (from the *previous* module generation) fails with
 * an unrelated-looking "can't resolve ModuleRef" error. Importing
 * `NestFactory` dynamically, from the same reset, is what avoids that.
 */
describe('production boot: legacy card-payment subsystem (CARD_PAYMENTS_ENABLED)', () => {
  const envKeys = [
    'NODE_ENV',
    'CARD_PAYMENTS_ENABLED',
    'DEMO_MODE',
    'SMS_ENDPOINT',
    'PUSH_ENABLED',
    'PUSH_ENDPOINT',
    'REDIS_URL',
  ] as const;
  const saved: Partial<Record<(typeof envKeys)[number], string>> = {};

  beforeEach(() => {
    for (const key of envKeys) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.resetModules();
  });

  /**
   * Every other commercial boot guard (SMS/Push/Redis, exactly like
   * PaymentsModule's own) is given a real-looking config value here, so
   * that in the tests below the only thing left unconfigured is the PSP —
   * proving a boot failure is specifically about PaymentsModule and not a
   * sibling guard tripping for an unrelated reason.
   */
  function configureProductionExceptPsp(): void {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    process.env.SMS_ENDPOINT = 'https://sms.example.test/send';
    process.env.PUSH_ENABLED = 'true';
    process.env.PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  }

  /** Re-imports `AppModule` and `NestFactory` together, from one fresh module registry. */
  async function freshAppModuleAndFactory() {
    jest.resetModules();
    const [{ AppModule }, { NestFactory }] = await Promise.all([
      import('../src/app.module'),
      import('@nestjs/core'),
    ]);
    return { AppModule, NestFactory: NestFactory as typeof NestFactoryType };
  }

  it('A: boots in production with card payments disabled and no PSP configured', async () => {
    configureProductionExceptPsp();
    delete process.env.CARD_PAYMENTS_ENABLED;

    const { AppModule, NestFactory } = await freshAppModuleAndFactory();
    const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
    try {
      expect(app).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('B: fails closed in production when card payments are enabled but no production PSP is configured', async () => {
    configureProductionExceptPsp();
    process.env.CARD_PAYMENTS_ENABLED = 'true';

    const { AppModule, NestFactory } = await freshAppModuleAndFactory();
    await expect(
      NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }),
    ).rejects.toThrow(/no production PSP adapter is configured/);
  });

  it('C: with card payments disabled, the legacy /payments and /refunds HTTP surfaces do not exist', async () => {
    configureProductionExceptPsp();
    delete process.env.CARD_PAYMENTS_ENABLED;

    jest.resetModules();
    const [{ AppModule }, { NestFactory }, { PaymentsController }, { RefundsController }] =
      await Promise.all([
        import('../src/app.module'),
        import('@nestjs/core'),
        import('../src/modules/payments/payments.controller'),
        import('../src/modules/payments/refunds.controller'),
      ]);
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
    try {
      // Nest throws (rather than returning undefined) when a class was
      // never registered as a provider/controller in any imported module —
      // the established way, in this codebase, to prove a route was never
      // wired up, since there is no HTTP-level e2e harness here.
      expect(() => app.get(PaymentsController)).toThrow();
      expect(() => app.get(RefundsController)).toThrow();
    } finally {
      await app.close();
    }
  });
});
