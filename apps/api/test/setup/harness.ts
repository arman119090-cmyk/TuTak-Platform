import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import configuration from '../../src/config/configuration';
import type Redis from 'ioredis';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { REDIS_CLIENT, RedisModule } from '../../src/infrastructure/redis/redis.module';
import { SmsModule } from '../../src/infrastructure/sms/sms.module';
import { PushModule } from '../../src/infrastructure/push/push.module';
import { AlertsModule } from '../../src/infrastructure/alerts/alerts.module';
import { MediaStorageModule } from '../../src/infrastructure/media/media-storage.module';
import { MEDIA_STORAGE } from '../../src/infrastructure/media/media-storage.interface';
import { MemoryMediaStorage } from '../../src/infrastructure/media/memory-media-storage';
import { MediaModule } from '../../src/modules/media/media.module';
import { ALERT_CHANNEL } from '../../src/infrastructure/alerts/alert-channel.interface';
import { RecordingAlertChannel } from './recording-alert.channel';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AdminModule } from '../../src/modules/admin/admin.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module';
import { PurchaseIntentsModule } from '../../src/modules/purchase-intents/purchase-intents.module';
import { AnalyticsModule } from '../../src/modules/analytics/analytics.module';
import { LedgerModule } from '../../src/modules/ledger/ledger.module';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { SettlementModule } from '../../src/modules/settlement/settlement.module';
import { PayoutsModule } from '../../src/modules/payouts/payouts.module';
import { ReconciliationModule } from '../../src/modules/reconciliation/reconciliation.module';
import { RetentionModule } from '../../src/modules/retention/retention.module';
import { HealthModule } from '../../src/modules/health/health.module';
import { SecurityModule } from '../../src/modules/security/security.module';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { EvChargingModule } from '../../src/modules/ev-charging/ev-charging.module';
import { RoamingCpoModule } from '../../src/modules/roaming-cpo/roaming-cpo.module';
import { QrPaymentsModule } from '../../src/modules/qr-payments/qr-payments.module';
import { ReferralModule } from '../../src/modules/referral/referral.module';
import { TransactionsModule } from '../../src/modules/transactions/transactions.module';
import { UsersModule } from '../../src/modules/users/users.module';
import { WalletModule } from '../../src/modules/wallet/wallet.module';
import { TEST_DATABASE_URL } from './test-database';

/**
 * Boots the real domain modules against the real test database.
 *
 * Nothing is mocked below the controller layer on purpose. The properties
 * under test — transactional atomicity, Serializable conflict detection,
 * CHECK constraints, unique indexes, FIFO ordering by `expiresAt` — live in
 * PostgreSQL. A mocked Prisma client would assert the mock's behaviour and
 * pass while production corrupts balances.
 *
 * Note that `SweepsModule` is not imported. Recurring work runs on a BullMQ
 * worker, and a worker picking jobs up in the background would sweep a table
 * mid-assertion. The sweeps are exercised deliberately in
 * `sweeps.int-spec.ts`, which drives the processor by hand.
 */
export interface TestHarness {
  app: TestingModule;
  prisma: PrismaClient;
  /**
   * Everything the platform tried to tell a human during the test.
   *
   * Exposed because "money moved wrongly" and "money moved wrongly and
   * nobody was told" are different failures, and only the tests can tell
   * them apart before production does.
   */
  alerts: RecordingAlertChannel;
  /** The in-memory object store the media suites read back out of. */
  mediaStorage: MemoryMediaStorage;
  /** Clears captured alerts *and* the Redis suppression window. */
  resetAlerts(): Promise<void>;
  close(): Promise<void>;
}

/**
 * An emitter that remembers what it started, so a test can wait for it.
 *
 * Domain events are dispatched with `emit`, which returns the moment the
 * listeners are *called* rather than when they finish. In production that is
 * right: nobody should wait on a welcome notification. In a test it means a
 * listener can still be writing a notification row while the next test
 * truncates the table it is writing to — which surfaced as a stream of
 * `notifications_userId_fkey` violations for users that no longer existed,
 * and, on a loaded CI runner, as a deadlock between that INSERT and the
 * TRUNCATE. PostgreSQL resolves a deadlock by killing one side; when it chose
 * the TRUNCATE, the suite failed somewhere unrelated to whatever had actually
 * gone wrong.
 *
 * This does not change what the application does. It changes only what the
 * harness knows: `settle()` waits until the work the app started is finished,
 * which is the precondition every truncation silently assumed.
 */
class SettleableEventEmitter extends EventEmitter2 {
  private readonly inFlight = new Set<Promise<unknown>>();

  override emit(event: string | symbol, ...values: unknown[]): boolean {
    const pending = this.emitAsync(event, ...values);
    this.inFlight.add(pending);
    // Rejections are the listener's business — every one of them already
    // catches and logs. This only tracks completion.
    void pending.catch(() => undefined).finally(() => this.inFlight.delete(pending));
    return true;
  }

  /** Resolves once nothing the app started is still running. */
  async settle(): Promise<void> {
    // A loop rather than a single await: a listener may emit further events.
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }
}

/**
 * The emitter belonging to the harness currently under test.
 *
 * Module-level so `truncateAll` can reach it without every one of the thirty
 * suites that call it having to thread an argument through.
 */
let activeEmitter: SettleableEventEmitter | null = null;

/**
 * Waits for everything the application started to finish, without touching
 * any data.
 *
 * `truncateAll` does this first; a test that wants to *look* at what a
 * listener wrote calls it directly, since truncation would then remove the
 * evidence.
 */
export async function settleEvents(): Promise<void> {
  await activeEmitter?.settle();
}

/** Tables holding reference data that survives per-test truncation. */
const PRESERVED_TABLES = new Set(['roles', 'permissions', 'role_permissions', '_prisma_migrations']);

/**
 * The domain module set every suite in this file boots, shared by both
 * harnesses below so the two can never drift apart on what "the real app,
 * minus infra swapped for fakes" means.
 */
function domainTestingModuleBuilder(
  prisma: PrismaClient,
  alerts: RecordingAlertChannel,
  mediaStorage: MemoryMediaStorage,
  emitter: SettleableEventEmitter,
) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
      EventEmitterModule.forRoot(),
      PrismaModule,
      RedisModule,
      SmsModule,
      PushModule,
      AlertsModule,
      MediaStorageModule,
      MediaModule,
      WalletModule,
      TransactionsModule,
      QrPaymentsModule,
      EvChargingModule,
      RoamingCpoModule,
      AuditModule,
      UsersModule,
      AdminModule,
      ReferralModule,
      PurchaseIntentsModule,
      NotificationsModule,
      AuthModule,
      SecurityModule,
      AnalyticsModule,
      LedgerModule,
      PaymentsModule,
      SettlementModule,
      PayoutsModule,
      ReconciliationModule,
      RetentionModule,
      HealthModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(ALERT_CHANNEL)
    .useValue(alerts)
    .overrideProvider(MEDIA_STORAGE)
    .useValue(mediaStorage)
    // Nest wires every `@OnEvent` handler onto the injected EventEmitter2
    // instance, so replacing the instance is enough — no listener needs to
    // know it happened.
    .overrideProvider(EventEmitter2)
    .useValue(emitter);
}

export async function createTestHarness(): Promise<TestHarness> {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

  const alerts = new RecordingAlertChannel();
  const emitter = new SettleableEventEmitter();
  // Spec §3.2: "tests use an in-memory fake". Everything above the storage
  // boundary is the real code — the image pipeline really re-encodes, the
  // delivery service really signs — only the bytes' destination changes.
  const mediaStorage = new MemoryMediaStorage();

  const moduleRef = await domainTestingModuleBuilder(prisma, alerts, mediaStorage, emitter).compile();

  // TestingModule *is* an application context — no HTTP adapter is created,
  // so the suites exercise the services directly with no server listening.
  await moduleRef.init();
  activeEmitter = emitter;

  const redis = moduleRef.get<Redis>(REDIS_CLIENT);

  return {
    app: moduleRef,
    prisma,
    alerts,
    mediaStorage,
    async resetAlerts() {
      alerts.clear();
      // Suppression lives in Redis and survives table truncation, so without
      // this the second test in a file would find its alert silently
      // swallowed by the first test's fifteen-minute window.
      const keys = await redis.keys('alert:sent:*');
      if (keys.length) await redis.del(...keys);
    },
    async close() {
      // Anything still running would otherwise write into a database the
      // next file is about to reset.
      await emitter.settle();
      if (activeEmitter === emitter) activeEmitter = null;
      // ioredis doesn't implement OnModuleDestroy, so Nest's own shutdown
      // hooks never reach it — left unclosed, the open TCP handle keeps the
      // Jest worker alive after every test in the file has finished.
      await redis.quit();
      await moduleRef.close();
      await prisma.$disconnect();
    },
  };
}

export interface HttpTestHarness {
  app: INestApplication;
  /** `http://127.0.0.1:<port>` of the listening instance — build request URLs off this. */
  baseUrl: string;
  prisma: PrismaClient;
  close(): Promise<void>;
}

/**
 * `createTestHarness` above is deliberately not this: as its own docblock
 * says, nothing in this suite drives a real HTTP request, because the
 * properties under test almost always live below the controller layer. A
 * `ParseUUIDPipe` on a route parameter is the opposite case — it is
 * Nest's request-argument pipeline itself, which only runs when a real
 * HTTP request is dispatched through a real Nest application, the same way
 * `ThrottlerGuard` only runs there (see `media-system.int-spec.ts`'s
 * "upload rate limiting" tests and docs/PENTEST_2026-08-23.md §B.1 for that
 * precedent, which pins the guard's config via reflection instead — not
 * viable here, since `ParseUUIDPipe` is a bare class reference on `@Param`,
 * not `@Throttle`'s inspectable metadata).
 *
 * This exists only for `id-validation.int-spec.ts`. It reuses the exact same
 * domain modules and fakes as `createTestHarness` — so it is exercising the
 * real `ValidationPipe`/`ParseUUIDPipe`/`AllExceptionsFilter` wiring
 * `main.ts` installs, just assembled here instead of read off a running
 * process — but note that `AppModule`'s global guards
 * (`JwtAuthGuard`/`RolesGuard`/`PermissionsGuard`/`PasswordRotationGuard`/
 * `ThrottlerGuard`) are `APP_GUARD` providers declared on `AppModule`
 * itself, which neither harness imports, so requests here reach the
 * controller with no auth enforcement. That is fine for what this file
 * proves — a pipe rejects a malformed id during argument resolution, before
 * the handler body (and therefore before whatever `@CurrentUser()` would
 * have needed) ever runs — and it is why the fix's live proof against the
 * real running server, in docs/ID_VALIDATION_2026-08-23.md, is the evidence
 * that authenticated routes behave the same way end-to-end, guards included.
 */
export async function createHttpTestHarness(): Promise<HttpTestHarness> {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  const alerts = new RecordingAlertChannel();
  const emitter = new SettleableEventEmitter();
  const mediaStorage = new MemoryMediaStorage();

  const moduleRef = await domainTestingModuleBuilder(prisma, alerts, mediaStorage, emitter).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // Mirrors `main.ts` bootstrap and `AppModule`'s global providers for the
  // pieces that matter to this suite: the same `ValidationPipe` options, the
  // same `/v1` URI versioning, and the same `AllExceptionsFilter`/
  // `TransformInterceptor` (both `APP_FILTER`/`APP_INTERCEPTOR` on
  // `AppModule`, so — like the guards discussed above — they have to be
  // attached by hand here rather than inherited).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : address;
  const baseUrl = `http://127.0.0.1:${port}`;

  activeEmitter = emitter;
  const redis = moduleRef.get<Redis>(REDIS_CLIENT);

  return {
    app,
    baseUrl,
    prisma,
    async close() {
      await emitter.settle();
      if (activeEmitter === emitter) activeEmitter = null;
      await redis.quit();
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/**
 * Wipes fixture data between tests.
 *
 * Discovers tables from the catalogue rather than hard-coding a list, so a
 * new model cannot silently start leaking rows across tests — a leak that
 * would show up as a flaky balance assertion much later.
 */
export async function truncateAll(prisma: PrismaClient) {
  // Wait for the application to go quiet first. Truncating underneath a
  // listener that is still writing is what produced the foreign-key noise and
  // the TRUNCATE/INSERT deadlock described on `SettleableEventEmitter`.
  await activeEmitter?.settle();

  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = rows
    .map((r) => r.tablename)
    .filter((name) => !PRESERVED_TABLES.has(name))
    .map((name) => `"public"."${name}"`);

  if (targets.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${targets.join(', ')} RESTART IDENTITY CASCADE`);
}
