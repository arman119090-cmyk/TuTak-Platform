import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import configuration from '../../src/config/configuration';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { SmsModule } from '../../src/infrastructure/sms/sms.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AdminModule } from '../../src/modules/admin/admin.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module';
import { AnalyticsModule } from '../../src/modules/analytics/analytics.module';
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
 * Note that no `ScheduleModule` is imported: the cron services are
 * constructed as plain providers, so the sweepers run only when a test calls
 * them, never spontaneously in the middle of an assertion.
 */
export interface TestHarness {
  app: TestingModule;
  prisma: PrismaClient;
  close(): Promise<void>;
}

/** Tables holding reference data that survives per-test truncation. */
const PRESERVED_TABLES = new Set(['roles', 'permissions', 'role_permissions', '_prisma_migrations']);

export async function createTestHarness(): Promise<TestHarness> {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
      EventEmitterModule.forRoot(),
      PrismaModule,
      SmsModule,
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
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  // TestingModule *is* an application context — no HTTP adapter is created,
  // so the suites exercise the services directly with no server listening.
  await moduleRef.init();

  return {
    app: moduleRef,
    prisma,
    async close() {
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
