import type { INestApplicationContext } from '@nestjs/common';
import type { NestFactory as NestFactoryType } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

/**
 * Every test below sets `REDIS_URL` to what looks like a real Redis and
 * boots the genuine `AppModule` — `RedisModule` and, via `QueueModule`,
 * BullMQ's own internal `ioredis` client included. Most of these boots are
 * *supposed* to fail (that's what's under test: a misconfigured guard must
 * refuse to start), and `NestFactory.createApplicationContext`'s promise
 * simply rejects on failure — it does not return a partial application
 * reference. Both `RedisModule` and `QueueModule` are `@Global()` and
 * resolve early in the DI graph, so by the time a *later* guard (the PSP
 * check, the media-storage check) throws during its own provider
 * construction, they had already each opened a real TCP connection — which
 * can then never be closed through any Nest API, because nothing in this
 * file ever gets a reference to what was partially built. Worse: killing
 * such a connection from the Redis side (`CLIENT KILL`) does not help
 * either — the orphaned `ioredis` client object nothing in this file holds a
 * reference to just reconnects, because nothing ever told *it* to give up.
 * Left alone, this leaked a live connection for every rejected boot in this
 * file, and Jest never exited after the test run finished.
 *
 * No test in this file asserts anything about Redis actually working — it
 * only needs `REDIS_URL` to be *present*, exactly like every other sibling
 * guard `configureProductionExceptPsp` deliberately satisfies with a
 * real-looking value so a failure is unambiguous about the one guard under
 * test. So the fix is at the root: a fake `ioredis` that never opens a
 * socket at all is a closer match to that intent than a real client with
 * nowhere to be closed.
 *
 * `bullmq` needs more of that mocking than `RedisModule` alone would: its
 * `Worker` calls `defineCommand` on the client to register its Lua scripts
 * and, once constructed, actively polls — a plain `on`/`quit`-only fake
 * satisfies `RedisModule` but throws ("defineCommand is not a function")
 * and then keeps retrying forever inside `bullmq`'s own internals, which is
 * the same unreachable-orphan problem in a different shape. `bullmq` itself
 * is mocked too for exactly the reason `ioredis` is: nothing here asserts
 * anything about queueing actually working, so a `Queue`/`Worker` that never
 * does real work is a closer match to intent than a real one this file can
 * never reach to close.
 */
jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'ready';
    call = jest.fn().mockResolvedValue(null);
    set = jest.fn().mockResolvedValue('OK');
    get = jest.fn().mockResolvedValue(null);
    eval = jest.fn().mockResolvedValue(null);
    keys = jest.fn().mockResolvedValue([]);
    del = jest.fn().mockResolvedValue(0);
    duplicate = jest.fn(() => new FakeRedis());
    quit = jest.fn().mockResolvedValue('OK');
    disconnect = jest.fn();
  }
  return { __esModule: true, default: FakeRedis };
});

jest.mock('bullmq', () => {
  class FakeQueueLike extends EventEmitter {
    close = jest.fn().mockResolvedValue(undefined);
    disconnect = jest.fn().mockResolvedValue(undefined);
    obliterate = jest.fn().mockResolvedValue(undefined);
    add = jest.fn().mockResolvedValue({ id: 'fake' });
    run = jest.fn().mockResolvedValue(undefined);
    getRepeatableJobs = jest.fn().mockResolvedValue([]);
    removeRepeatableByKey = jest.fn().mockResolvedValue(undefined);
    waitUntilReady = jest.fn().mockResolvedValue(undefined);
    // SweepsScheduler.onApplicationBootstrap calls these during a boot that
    // succeeds far enough to reach lifecycle hooks (tests A and E's last
    // case) — see that class's own docblock on why the schedule is
    // registered idempotently on every boot.
    getJobSchedulers = jest.fn().mockResolvedValue([]);
    upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    removeJobScheduler = jest.fn().mockResolvedValue(undefined);
  }
  return {
    __esModule: true,
    Queue: FakeQueueLike,
    Worker: FakeQueueLike,
    QueueEvents: FakeQueueLike,
    FlowProducer: FakeQueueLike,
  };
});

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
    'MEDIA_STORAGE_DRIVER',
    'MEDIA_STORAGE_S3_ENDPOINT',
    'MEDIA_STORAGE_S3_BUCKET',
    'MEDIA_STORAGE_S3_REGION',
    'MEDIA_STORAGE_S3_ACCESS_KEY_ID',
    'MEDIA_STORAGE_S3_SECRET_ACCESS_KEY',
    'MEDIA_PUBLIC_BASE_URL',
    // Security hardening (2026-08-23): every test in this file boots a real
    // `NODE_ENV=production` context, which since that pass includes
    // `assertProductionJwtSecretsAreStrong` (env.validation.ts) — production
    // now refuses to start on a placeholder-shaped or low-entropy JWT
    // secret. This file used to boot on whatever `JWT_ACCESS_SECRET`/
    // `JWT_REFRESH_SECRET` happened to already be sitting in `process.env`
    // rather than setting them itself, which is fragile independent of that
    // guard — a local `apps/api/.env` file (present in some dev sandboxes,
    // never committed) gets loaded into `process.env` ambiently by
    // Prisma's own auto-`.env`-loading during `globalSetup`, ahead of
    // `jest-setup.ts`'s `??=` defaults, so this suite's "production" boot
    // could silently run on whatever a developer's local `.env` happened to
    // contain. Saved/restored here and set explicitly below so this file's
    // production context never depends on ambient state for something
    // security-critical, in this sandbox or any other.
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
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
    // Two independently strong, distinct secrets — satisfies
    // `assertProductionJwtSecretsAreStrong` so every test below fails (or
    // succeeds) for the reason it is actually testing (PSP/media-storage
    // configuration), not because of whatever JWT secret happened to be
    // ambiently set. Regenerated per call so no single fixed value could
    // itself accidentally start matching a future placeholder pattern.
    process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');
    process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
    process.env.SMS_ENDPOINT = 'https://sms.example.test/send';
    process.env.PUSH_ENABLED = 'true';
    process.env.PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    // MediaStorageModule is a boot guard of exactly the same shape (see its
    // docblock), added 2026-08-23. Configured here for the same reason as
    // the three above: so a failure in these tests is unambiguously about
    // the PSP and not a sibling guard tripping.
    process.env.MEDIA_STORAGE_DRIVER = 's3';
    process.env.MEDIA_STORAGE_S3_ENDPOINT = 'https://s3.example.test';
    process.env.MEDIA_STORAGE_S3_BUCKET = 'tutak-media';
    process.env.MEDIA_STORAGE_S3_REGION = 'eu-central-1';
    process.env.MEDIA_STORAGE_S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.MEDIA_STORAGE_S3_SECRET_ACCESS_KEY = 'secret';
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://api.example.test';
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

  /**
   * P0 hardening pass, 2026-08-19: the new refund-PSP-confirmation sweep
   * (`payments.reconcile-pending-refunds`) depends on `RefundEngineService`,
   * which only exists when `PaymentsModule` is loaded. `SweepsModule` used
   * to import `PaymentsModule` and inject that service unconditionally —
   * which meant `SweepsModule` (itself unconditional in `AppModule`) forced
   * `PaymentsModule`'s own production boot guard (real PSP or
   * `DEMO_MODE=true`) into *every* deployment regardless of
   * `CARD_PAYMENTS_ENABLED`, breaking test A above the moment the sweep was
   * added. Fixed by gating `SweepsModule`'s `PaymentsModule` import and the
   * sweep's own registration on the identical `cardPaymentsEnabled` flag
   * `app.module.ts` already uses. This test proves both directions
   * explicitly, at the `SWEEPS` registry level rather than only indirectly
   * through test A's boot succeeding.
   */
  it('D: the PSP-refund reconciliation sweep exists only when card payments are enabled', async () => {
    configureProductionExceptPsp();
    delete process.env.CARD_PAYMENTS_ENABLED;

    jest.resetModules();
    const disabled = await import('../src/modules/sweeps/sweeps.jobs');
    expect(disabled.SWEEPS.some((s) => s.name === 'payments.reconcile-pending-refunds')).toBe(
      false,
    );

    process.env.CARD_PAYMENTS_ENABLED = 'true';
    jest.resetModules();
    const enabled = await import('../src/modules/sweeps/sweeps.jobs');
    expect(enabled.SWEEPS.some((s) => s.name === 'payments.reconcile-pending-refunds')).toBe(true);
  });

  /**
   * The media system's own production guard (TUTAK_V2_MEDIA_SYSTEM_SPEC.md
   * §3.2, added 2026-08-23), tested here alongside its siblings because it
   * has the same shape and the same reason to exist.
   *
   * The failure it prevents is quieter than a missing acquirer and worse to
   * find late: production on the local-disk driver looks entirely healthy.
   * Uploads succeed. The image comes back — from the replica that handled
   * the upload. Then the load balancer picks the other one and half the
   * partner logos on the network are 404s, and a database restore makes it
   * *every* logo, because the bytes were never in anything backed up.
   */
  describe('E: media storage must be durable in production', () => {
    it('refuses to boot on the local-disk driver', async () => {
      configureProductionExceptPsp();
      delete process.env.CARD_PAYMENTS_ENABLED;
      process.env.MEDIA_STORAGE_DRIVER = 'local';

      const { AppModule, NestFactory } = await freshAppModuleAndFactory();
      await expect(
        NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }),
      ).rejects.toThrow(/MEDIA_STORAGE_DRIVER .* in production/);
    });

    it('refuses to boot on s3 with a credential missing', async () => {
      configureProductionExceptPsp();
      delete process.env.CARD_PAYMENTS_ENABLED;
      delete process.env.MEDIA_STORAGE_S3_SECRET_ACCESS_KEY;

      const { AppModule, NestFactory } = await freshAppModuleAndFactory();
      await expect(
        NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }),
      ).rejects.toThrow(/MEDIA_STORAGE_S3_SECRET_ACCESS_KEY/);
    });

    it('refuses to boot without a public base URL for the media it serves', async () => {
      configureProductionExceptPsp();
      delete process.env.CARD_PAYMENTS_ENABLED;
      delete process.env.MEDIA_PUBLIC_BASE_URL;

      const { AppModule, NestFactory } = await freshAppModuleAndFactory();
      await expect(
        NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }),
      ).rejects.toThrow(/MEDIA_PUBLIC_BASE_URL/);
    });

    it('is not exempted by demo mode, unlike the carrier and the acquirer', async () => {
      // A demonstration has no telco contract and no bank, and faking those
      // costs nothing. Object storage has no such excuse — a bucket costs
      // cents, and the demo's own images vanishing on the next redeploy
      // would be visible to precisely the audience the demo exists for.
      configureProductionExceptPsp();
      delete process.env.CARD_PAYMENTS_ENABLED;
      process.env.DEMO_MODE = 'true';
      process.env.MEDIA_STORAGE_DRIVER = 'local';

      const { AppModule, NestFactory } = await freshAppModuleAndFactory();
      await expect(
        NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }),
      ).rejects.toThrow(/MEDIA_STORAGE_DRIVER .* in production/);
    });

    it('boots on a fully configured s3 driver', async () => {
      configureProductionExceptPsp();
      delete process.env.CARD_PAYMENTS_ENABLED;

      const { AppModule, NestFactory } = await freshAppModuleAndFactory();
      const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, {
        logger: false,
        abortOnError: false,
      });
      try {
        const { MEDIA_STORAGE } = await import('../src/infrastructure/media/media-storage.interface');
        expect(app.get(MEDIA_STORAGE).driverName).toBe('s3');
      } finally {
        await app.close();
      }
    });
  });
});
