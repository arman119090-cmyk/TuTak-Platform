import { TEST_DATABASE_URL } from './test-database';

// Integration tests boot a Nest context and open real transactions; the 5s
// default trips on the first cold connection rather than on a real hang.
jest.setTimeout(60_000);

// Every integration test opens its own Prisma client; pinning the URL here
// guarantees none of them can accidentally reach the development database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';

// Config defaults the domain services read. Kept small and explicit so a test
// asserting "48h pending" is asserting the configured value, not a surprise
// from a developer's local .env.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-not-used-for-signing-anything-real';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-not-used-for-signing-anything-real';
process.env.BONUS_PENDING_HOURS ??= '48';
process.env.BONUS_EXPIRY_MONTHS ??= '12';
process.env.BONUS_RESERVATION_HOLD_SECONDS ??= '300';
