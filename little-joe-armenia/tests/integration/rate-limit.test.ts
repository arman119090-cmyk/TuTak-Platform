import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../support/db";
import { rateLimit, RULES } from "@/lib/security/rate-limit";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await testDb.$disconnect();
});

describe("rateLimit", () => {
  it("allows up to the limit, then blocks; other identities are independent", async () => {
    const limit = RULES.promo.limit;
    for (let i = 1; i <= limit; i++) {
      const r = await rateLimit("promo", "ip-1");
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(limit - i);
    }
    const blocked = await rateLimit("promo", "ip-1");
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(RULES.promo.windowMs / 1000);

    expect((await rateLimit("promo", "ip-2")).ok).toBe(true);
    expect((await rateLimit("checkout", "ip-1")).ok).toBe(true);
  });

  it("counts concurrent hits atomically", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit("promo", "burst")));
    expect(results.filter((r) => r.ok)).toHaveLength(RULES.promo.limit);
    const row = await testDb.rateLimit.findUniqueOrThrow({ where: { key: "promo:burst" } });
    expect(row.count).toBe(20);
  });

  it("restarts the window once it has expired", async () => {
    for (let i = 0; i < RULES.promo.limit + 1; i++) await rateLimit("promo", "old");
    expect((await rateLimit("promo", "old")).ok).toBe(false);
    await testDb.rateLimit.update({ where: { key: "promo:old" }, data: { windowStart: new Date(Date.now() - RULES.promo.windowMs - 1000) } });
    const r = await rateLimit("promo", "old");
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(RULES.promo.limit - 1);
  });
});
