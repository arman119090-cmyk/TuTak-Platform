import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Money } from '@cashout/money';
import { AppModule } from '../src/app.module';
import { Clock, FixedClock } from '../src/common/clock';
import { Env, loadEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { RateLimiter } from '../src/common/rate-limit.service';
import { ConsoleSmsGateway } from '../src/modules/auth/sms-gateway.port';
import { YandexMockAdapter } from '../src/modules/yandex/yandex-mock.adapter';
import { PaymentProviderMockAdapter } from '../src/modules/payment-provider/payment-provider-mock.adapter';
import { WithdrawalOrchestrator } from '../src/modules/withdrawals/withdrawal.orchestrator';
import { WithdrawalsService } from '../src/modules/withdrawals/withdrawals.service';
import { WithdrawalWorker } from '../src/modules/withdrawals/withdrawal.worker';
import { QuoteService } from '../src/modules/withdrawals/quote.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { ProviderWebhookService } from '../src/modules/withdrawals/provider-webhook.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { AdminAuthService } from '../src/modules/admin/admin-auth.service';
import { PayoutMethodsService } from '../src/modules/payout-methods/payout-methods.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { DriversService } from '../src/modules/drivers/drivers.service';
import { BalanceService } from '../src/modules/drivers/balance.service';
import { MembershipService } from '../src/modules/parks/membership.service';
import { ParksAdminService } from '../src/modules/parks/parks-admin.service';

/**
 * Integration tests run against a real PostgreSQL database, not an in-memory
 * substitute.
 *
 * Half of what this codebase relies on for correctness lives in the database:
 * serialisable isolation, partial unique indexes, deferred constraint triggers,
 * advisory locks. A fake would test none of it, and those are exactly the parts
 * that stop a driver being paid twice.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://cashout:cashout@127.0.0.1:5432/cashout_test?schema=public';

export function testEnv(overrides: Partial<Env> = {}): Env {
  const base = loadEnv({
    NODE_ENV: 'test',
    DEPLOYMENT_ENV: 'local',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: TEST_DATABASE_URL,
    ENCRYPTION_KEY: 'a'.repeat(64),
    FINGERPRINT_KEY: 'b'.repeat(64),
    QUOTE_SIGNING_KEY: 'c'.repeat(64),
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-test',
    YANDEX_MODE: 'mock',
    PROVIDER_MODE: 'mock',
    PROVIDER_WEBHOOK_SECRET: 'test-webhook-secret-test-webhook-secret',
    QUOTE_TTL_SECONDS: '120',
    WITHDRAWAL_SLA_SECONDS: '900',
    OTP_RESEND_COOLDOWN_SECONDS: '15',
    ORCHESTRATOR_AUTO_ADVANCE: 'false',
    ...(overrides as Record<string, string>),
  } as NodeJS.ProcessEnv);
  return { ...base, ...overrides };
}

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  clock: FixedClock;
  yandex: YandexMockAdapter;
  provider: PaymentProviderMockAdapter;
  sms: ConsoleSmsGateway;
  rateLimiter: RateLimiter;
  orchestrator: WithdrawalOrchestrator;
  withdrawals: WithdrawalsService;
  worker: WithdrawalWorker;
  quotes: QuoteService;
  ledger: LedgerService;
  reconciliation: ReconciliationService;
  webhooks: ProviderWebhookService;
  admin: AdminService;
  adminAuth: AdminAuthService;
  payoutMethods: PayoutMethodsService;
  auth: AuthService;
  drivers: DriversService;
  balances: BalanceService;
  memberships: MembershipService;
  parksAdmin: ParksAdminService;
  close(): Promise<void>;
}

export async function createHarness(envOverrides: Partial<Env> = {}): Promise<Harness> {
  const env = testEnv(envOverrides);
  // Anchored to the wall clock at start-up rather than to a fixed literal: the
  // database stamps its own rows with now(), and a clock in a different decade
  // would make every age-based rule (quote expiry, risk, limit windows) read
  // nonsense. Tests move time with `clock.advanceSeconds`.
  const clock = new FixedClock(new Date());

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ env, enableScheduler: false })],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    clock,
    yandex: app.get(YandexMockAdapter),
    provider: app.get(PaymentProviderMockAdapter),
    sms: app.get(ConsoleSmsGateway),
    rateLimiter: app.get(RateLimiter),
    orchestrator: app.get(WithdrawalOrchestrator),
    withdrawals: app.get(WithdrawalsService),
    worker: app.get(WithdrawalWorker),
    quotes: app.get(QuoteService),
    ledger: app.get(LedgerService),
    reconciliation: app.get(ReconciliationService),
    webhooks: app.get(ProviderWebhookService),
    admin: app.get(AdminService),
    adminAuth: app.get(AdminAuthService),
    payoutMethods: app.get(PayoutMethodsService),
    auth: app.get(AuthService),
    drivers: app.get(DriversService),
    balances: app.get(BalanceService),
    memberships: app.get(MembershipService),
    parksAdmin: app.get(ParksAdminService),
    async close() {
      await app.close();
    },
  };
}

/** Order matters: children before parents. */
const TABLES = [
  'ledger_postings',
  'journal_entries',
  'ledger_accounts',
  'provider_events',
  'withdrawal_events',
  'reconciliation_mismatches',
  'reconciliation_runs',
  'withdrawals',
  'quotes',
  'balance_snapshots',
  'payout_methods',
  'sessions',
  'devices',
  'driver_id_change_requests',
  'park_switches',
  'roster_imports',
  'driver_park_memberships',
  'park_integration_credentials',
  'parks',
  'drivers',
  'users',
  'otp_challenges',
  'audit_logs',
  'outbox_messages',
  'idempotency_records',
  'fee_schedules',
  'limit_policies',
  'admin_sessions',
  'admin_users',
  'integration_health',
];

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // TRUNCATE rather than DELETE: it bypasses the append-only row triggers,
  // which is exactly why the production role must not be allowed to run it.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export async function seedPricing(
  prisma: PrismaClient,
  overrides: {
    platformRateNumerator?: bigint;
    platformFixedMinor?: bigint;
    platformMinMinor?: bigint | null;
    platformMaxMinor?: bigint | null;
    providerRateNumerator?: bigint;
    providerFixedMinor?: bigint;
    payoutIncrementMinor?: bigint;
    minWithdrawalMinor?: bigint;
    maxWithdrawalMinor?: bigint;
    dailyAmountMinor?: bigint;
    dailyCountMax?: number;
    velocityMaxCount?: number;
    manualReviewAboveMinor?: bigint | null;
  } = {},
): Promise<void> {
  // Effective well in the past, so a test's clock is always inside the window.
  const effectiveFrom = new Date('2020-01-01T00:00:00.000Z');

  await prisma.feeSchedule.create({
    data: {
      parkId: null,
      currency: 'AMD',
      effectiveFrom,
      platformRateNumerator: overrides.platformRateNumerator ?? 200n,
      platformRateDenominator: 10_000n,
      platformFixedMinor: overrides.platformFixedMinor ?? 5_000n,
      platformMinMinor: overrides.platformMinMinor ?? null,
      platformMaxMinor: overrides.platformMaxMinor ?? null,
      platformRounding: 'HALF_UP',
      providerRateNumerator: overrides.providerRateNumerator ?? 60n,
      providerRateDenominator: 10_000n,
      providerFixedMinor: overrides.providerFixedMinor ?? 1_000n,
      providerRounding: 'HALF_UP',
      payoutIncrementMinor: overrides.payoutIncrementMinor ?? 1n,
    },
  });

  await prisma.limitPolicy.create({
    data: {
      parkId: null,
      currency: 'AMD',
      effectiveFrom,
      minWithdrawalMinor: overrides.minWithdrawalMinor ?? 100_000n,
      maxWithdrawalMinor: overrides.maxWithdrawalMinor ?? 30_000_000n,
      dailyAmountMinor: overrides.dailyAmountMinor ?? 50_000_000n,
      dailyCountMax: overrides.dailyCountMax ?? 5,
      weeklyAmountMinor: 150_000_000n,
      monthlyAmountMinor: 400_000_000n,
      velocityWindowSeconds: 3600,
      velocityMaxCount: overrides.velocityMaxCount ?? 3,
      manualReviewAboveMinor:
        overrides.manualReviewAboveMinor === undefined ? null : overrides.manualReviewAboveMinor,
    },
  });
}

export interface SeededDriver {
  userId: string;
  driverId: string;
  payoutMethodId: string;
  phone: string;
  /** The park's internal id — what ledger keys, fees and limits are scoped by. */
  parkId: string;
  /** The park's Yandex id — what the mock Fleet API is addressed by. */
  yandexParkId: string;
  contractorProfileId: string;
}

/** A park with a roster row for `phone`, plus the matching mock Yandex profile. */
export async function seedPark(
  harness: Harness,
  options: {
    yandexParkId?: string;
    code?: string;
    name?: string;
    status?: 'ACTIVE' | 'SUSPENDED';
  } = {},
): Promise<{ id: string; yandexParkId: string }> {
  const yandexParkId = options.yandexParkId ?? 'park-1';
  const park = await harness.prisma.park.create({
    data: {
      code: options.code ?? yandexParkId,
      name: options.name ?? `Park ${yandexParkId}`,
      yandexParkId,
      currency: 'AMD',
      status: options.status ?? 'ACTIVE',
    },
  });
  return { id: park.id, yandexParkId };
}

export async function seedMembership(
  harness: Harness,
  park: { id: string; yandexParkId: string },
  options: {
    phone: string;
    contractorProfileId: string;
    balance?: bigint;
    firstName?: string;
    lastName?: string;
    eligibility?: 'ELIGIBLE' | 'INELIGIBLE' | 'PENDING_REVIEW';
    status?: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
    blocked?: boolean;
  },
): Promise<string> {
  harness.yandex.seed({
    parkId: park.yandexParkId,
    contractorProfileId: options.contractorProfileId,
    phone: options.phone,
    firstName: options.firstName ?? 'Ara',
    lastName: options.lastName ?? 'Sargsyan',
    licenceNumber: 'AM1234567',
    balance: Money.fromMinor(options.balance ?? 5_000_000n, 'AMD'),
    blocked: options.blocked,
  });
  const row = await harness.prisma.driverParkMembership.create({
    data: {
      parkId: park.id,
      phone: options.phone,
      externalProfileId: options.contractorProfileId,
      firstName: options.firstName ?? 'Ara',
      lastName: options.lastName ?? 'Sargsyan',
      eligibility: options.eligibility ?? 'ELIGIBLE',
      status: options.status ?? 'ACTIVE',
    },
  });
  return row.id;
}

/**
 * A driver who is in one park's roster, has signed in (so the roster row is
 * attached and the park auto-selected) and has an active payout method. The
 * starting point for every money test.
 */
export async function seedDriver(
  harness: Harness,
  options: {
    phone?: string;
    balance?: bigint;
    parkId?: string;
    contractorProfileId?: string;
    instrumentToken?: string;
  } = {},
): Promise<SeededDriver> {
  const phone = options.phone ?? '+37411000001';
  const yandexParkId = options.parkId ?? 'park-1';
  const contractorProfileId = options.contractorProfileId ?? `contractor-${phone.slice(-4)}`;

  const park =
    (await harness.prisma.park.findUnique({ where: { yandexParkId } })) ??
    (await seedPark(harness, { yandexParkId }));
  await seedMembership(
    harness,
    { id: park.id, yandexParkId },
    {
      phone,
      contractorProfileId,
      balance: options.balance,
    },
  );

  const user = await harness.prisma.user.create({
    data: { phone, locale: 'hy', driver: { create: {} } },
  });
  const driver = await harness.prisma.driver.findUniqueOrThrow({ where: { userId: user.id } });

  const profile = await harness.memberships.resolve(user.id);
  if (profile.resolution !== 'ACTIVE') {
    throw new Error(
      `seedDriver: expected the single park to be auto-selected, got ${profile.resolution}`,
    );
  }

  const method = await harness.payoutMethods.add(driver.id, {
    kind: 'CARD',
    providerToken: options.instrumentToken ?? 'tok_test_4242',
    currency: 'AMD',
    setAsDefault: true,
  });

  return {
    userId: user.id,
    driverId: driver.id,
    payoutMethodId: method.id,
    phone,
    parkId: park.id,
    yandexParkId,
    contractorProfileId,
  };
}

/** Requests a quote and immediately confirms it, as the app does. */
export async function requestWithdrawal(
  harness: Harness,
  driver: SeededDriver,
  amountMinor: bigint,
  idempotencyKey = `idem-${Math.random().toString(36).slice(2)}-${Date.now()}`,
) {
  const quote = await harness.quotes.create(driver.driverId, {
    payoutMethodId: driver.payoutMethodId,
    amount: { minor: amountMinor.toString(), currency: 'AMD' },
    all: false,
  });
  return harness.withdrawals.confirm(driver.driverId, {
    quoteId: quote.quoteId,
    signature: quote.signature,
    idempotencyKey,
  });
}
