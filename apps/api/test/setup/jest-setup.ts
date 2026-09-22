import { TEST_DATABASE_URL } from './test-database';

// Integration tests boot a Nest context and open real transactions; the 5s
// default trips on the first cold connection rather than on a real hang.
jest.setTimeout(60_000);

// Every integration test opens its own Prisma client; pinning the URL here
// guarantees none of them can accidentally reach the development database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
// Exercise the per-caller code path. Left unset, `CLIENT_IP_STRATEGY`
// defaults to `socket`, under which `OtpIpRateLimitService` deliberately
// stands down — so the per-IP suites would pass by not running the thing
// they exist to test.
process.env.CLIENT_IP_STRATEGY ??= 'xff-depth';
process.env.CLIENT_IP_TRUSTED_HOPS ??= '1';
// High enough that the ordinary suites never trip it; the budget's own
// tests set their own ceilings.
process.env.SMS_GLOBAL_MAX_PER_HOUR ??= '100000';
process.env.SMS_GLOBAL_MAX_PER_DAY ??= '1000000';

// Config defaults the domain services read. Kept small and explicit so a test
// asserting "48h pending" is asserting the configured value, not a surprise
// from a developer's local .env.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-not-used-for-signing-anything-real';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-not-used-for-signing-anything-real';
process.env.BONUS_PENDING_HOURS ??= '48';
process.env.BONUS_EXPIRY_MONTHS ??= '12';
process.env.BONUS_RESERVATION_HOLD_SECONDS ??= '300';
// The in-TuTak payment route, off by default in production until the
// product owner decides otherwise (15.09.2026). Turned on here because the suites below
// exercise it deliberately: leaving it off would make them pass by never
// reaching the code they exist to test.
process.env.TUTAK_PSP_ENABLED ??= 'true';
// The hybrid funding components (20.09.2026). Off in every real deployment;
// on here so the purchase, refund and settlement suites can exercise them.
// Suites that test the *off* behaviour override these before building their
// harness, the way `customer-balance-disabled.int-spec.ts` does for top-ups.
process.env.CUSTOMER_PREPAID_PURCHASE_ENABLED ??= 'true';
process.env.PARTNER_POS_PURCHASES_ENABLED ??= 'true';
// A route that is switched on must be a route that can actually be used —
// boot validation (`assertProviderPaymentsConfigured`) refuses an
// environment that enables the provider route without a merchant, a secret
// and an https form action, exactly as it would refuse such a deployment.
// The test environment therefore carries a coherent, obviously-fake
// provider. Suites that care about the exact values set their own in
// `beforeAll`; `??=` leaves those alone.
process.env.IDRAM_MERCHANT_ID ??= '110000110';
process.env.IDRAM_SECRET_KEY ??= 'integration-test-idram-secret-not-real';
process.env.IDRAM_FORM_ACTION ??= 'https://sandbox.idram.example/Payment/GetPayment';
