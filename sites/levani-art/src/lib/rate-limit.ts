/**
 * Fixed-window, in-memory rate limiter.
 *
 * Correct for a single server instance. With several instances each keeps its
 * own window, so the effective limit multiplies; swap `store` for Redis (or
 * the platform's KV) behind the same `hit()` when that matters.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const store = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;

  return {
    hit(key: string): { allowed: boolean; retryAfterMs: number } {
      const t = now();
      if (store.size > 10_000) {
        for (const [k, v] of store) if (v.resetAt <= t) store.delete(k);
      }
      const entry = store.get(key);
      if (!entry || entry.resetAt <= t) {
        store.set(key, { count: 1, resetAt: t + opts.windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }
      entry.count += 1;
      return entry.count <= opts.limit
        ? { allowed: true, retryAfterMs: 0 }
        : { allowed: false, retryAfterMs: entry.resetAt - t };
    },
  };
}
