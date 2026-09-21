/**
 * In-process fixed-window rate limiter.
 *
 * Good enough for a single-node demo and for making the auth and request
 * endpoints non-trivial to brute force. A multi-instance deployment should swap
 * the store for Redis — the call sites do not change.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export const rateLimit = (
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): RateLimitResult => {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
};

/** Test helper; also keeps the map from growing without bound in long runs. */
export const resetRateLimits = (): void => buckets.clear();

/**
 * Per-scope limits, overridable through the environment.
 *
 * The defaults are the production values. An end-to-end run signs in dozens of
 * times from one address, so the test server raises AUTH_RATE_LIMIT_MAX — that
 * is a deliberate, explicit opt-out, not a weaker default.
 */
export const authAttemptsLimit = (): number => {
  const configured = Number(process.env.AUTH_RATE_LIMIT_MAX);
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
};

export const clientKey = (request: Request, scope: string): string => {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
  return `${scope}:${ip}`;
};
