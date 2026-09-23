// Integration tests run against a real PostgreSQL database
// (TEST_DATABASE_URL, default postgresql://lj:lj@localhost:5432/lj_test).
// The schema is migrated once in globalSetup-like fashion by `pnpm test:integration`
// (see package.json) — here we only point the app at that database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://lj:lj@localhost:5432/lj_test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef0123456789abcdef";
process.env.APP_URL ??= "http://localhost:3000";
process.env.PAYMENTS_MODE ??= "mock";
process.env.DEMO_MODE ??= "true";
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";
