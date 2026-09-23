import "server-only";
import { db } from "@/lib/db";

// Fixed-window rate limiter stored in Postgres. A single atomic upsert per
// hit: when the stored window is older than `windowMs` the counter restarts.
// Good enough for a single-brand shop and works across instances without
// adding Redis to a free-tier deployment.

export type RateLimitRule = { limit: number; windowMs: number };

export const RULES = {
  authRequest: { limit: 5, windowMs: 15 * 60_000 },
  authVerify: { limit: 10, windowMs: 15 * 60_000 },
  adminLogin: { limit: 5, windowMs: 15 * 60_000 },
  checkout: { limit: 10, windowMs: 10 * 60_000 },
  promo: { limit: 15, windowMs: 10 * 60_000 },
  review: { limit: 5, windowMs: 60 * 60_000 },
  webhook: { limit: 120, windowMs: 60_000 },
  cart: { limit: 120, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

export async function rateLimit(bucket: keyof typeof RULES, identity: string): Promise<RateLimitResult> {
  const rule = RULES[bucket];
  const key = `${bucket}:${identity}`.slice(0, 200);
  const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - (${rule.windowMs}::int * interval '1 millisecond')
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - (${rule.windowMs}::int * interval '1 millisecond')
                     THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"`;
  const row = rows[0]!;
  const resetAt = row.windowStart.getTime() + rule.windowMs;
  return {
    ok: row.count <= rule.limit,
    remaining: Math.max(0, rule.limit - row.count),
    retryAfterSec: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}
