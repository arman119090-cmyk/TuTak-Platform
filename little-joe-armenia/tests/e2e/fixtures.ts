import { test as base } from "@playwright/test";
import pg from "pg";

// Every e2e request comes from 127.0.0.1, so the app's real per-IP rate
// limits (checkout 10/10 min, admin login 5/15 min…) would trip across a
// full run. Instead of weakening the app, tests reset the counters in the
// app's database before each test. E2E_DATABASE_URL must point at the
// database of the server under test (default: local dev database).
const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://lj:lj@localhost:5432/lj";

export const test = base.extend<{ resetRateLimits: void }>({
  resetRateLimits: [
    async ({}, use) => {
      const client = new pg.Client({ connectionString: url });
      try {
        await client.connect();
        await client.query('DELETE FROM "RateLimit"');
      } finally {
        await client.end().catch(() => undefined);
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
