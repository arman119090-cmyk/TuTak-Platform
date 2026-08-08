import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import configuration from '../../src/config/configuration';
import type Redis from 'ioredis';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { REDIS_CLIENT, RedisModule } from '../../src/infrastructure/redis/redis.module';
import { SmsModule } from '../../src/infrastructure/sms/sms.module';
import { PushModule } from '../../src/infrastructure/push/push.module';
import { AlertsModule } from '../../src/infrastructure/alerts/alerts.module';
import { ALERT_CHANNEL } from '../../src/infrastructure/alerts/alert-channel.interface';
import { RecordingAlertChannel } from './recording-alert.channel';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AdminModule } from '../../src/modules/admin/admin.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module';
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
  /** Clears captured alerts *and* the Redis suppression window. */
  resetAlerts(): Promise<void>;
  close(): Promise<void>;
}

/** Tables holding reference data that survives per-test truncation. */
const PRESERVED_TABLES = new Set(['roles', 'permissions', 'role_permissions', '_prisma_migrations']);

export async function createTestHarness(): Promise<TestHarness> {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

  const alerts = new RecordingAlertChannel();

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
      EventEmitterModule.forRoot(),
      PrismaModule,
      RedisModule,
      SmsModule,
      PushModule,
      AlertsModule,
      WalletModule,
      TransactionsModule,
      QrPaymentsModule,
      EvChargingModule,
      AuditModule,
      UsersModule,
      AdminModule,
      ReferralModule,
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
    .compile();

  // TestingModule *is* an application context — no HTTP adapter is created,
  // so the suites exercise the services directly with no server listening.
  await moduleRef.init();

  const redis = moduleRef.get<Redis>(REDIS_CLIENT);

  return {
    app: moduleRef,
    prisma,
    alerts,
    async resetAlerts() {
      alerts.clear();
      // Suppression lives in Redis and survives table truncation, so without
      // this the second test in a file would find its alert silently
      // swallowed by the first test's fifteen-minute window.
      const keys = await redis.keys('alert:sent:*');
      if (keys.length) await redis.del(...keys);
    },
    async close() {
      // ioredis doesn't implement OnModuleDestroy, so Nest's own shutdown
      // hooks never reach it — left unclosed, the open TCP handle keeps the
      // Jest worker alive after every test in the file has finished.
      await redis.quit();
      await moduleRef.close();
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
