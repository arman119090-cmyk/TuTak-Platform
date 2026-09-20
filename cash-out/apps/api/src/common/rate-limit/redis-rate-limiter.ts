import { Injectable } from '@nestjs/common';
import { AppError } from '../app-error';
import { AppLogger } from '../logging/logger.service';
import { RateLimiter, RateLimitResult } from '../rate-limit.service';

/**
 * The subset of a Redis client the limiter needs. `ioredis` satisfies it;
 * tests hand in an in-memory fake, and a fake that throws models an outage.
 */
export interface RedisCommands {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(
    cursor: string,
    matchKeyword: 'MATCH',
    pattern: string,
    countKeyword: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;
  ping(): Promise<string>;
}

export type RedisOutagePolicy = 'deny' | 'allow';

export interface RedisRateLimiterOptions {
  /** Every key is namespaced so one Redis can serve several deployments. */
  readonly keyPrefix: string;
  /**
   * What to do when Redis cannot answer. `deny` (the default) refuses the
   * request with RATE_LIMITED and a short retry — the endpoints behind this
   * limiter are OTP, PIN and admin sign-in, where an unlimited window during an
   * outage is worse than a few minutes of refusals. `allow` lets traffic
   * through unlimited and is only for deployments that accept that trade.
   */
  readonly outagePolicy: RedisOutagePolicy;
  /** Retry-After sent while denying during an outage. */
  readonly outageRetryAfterSeconds?: number;
}

/**
 * INCR and the TTL in one atomic step, so two API instances racing on the
 * same key cannot both see "first hit" and both start a window. The count
 * is incremented before the limit is checked: a denied request still counts,
 * so hammering a locked key never resets it. PTTL < 0 means the key somehow
 * exists without an expiry (a crash between INCR and PEXPIRE on an older
 * Redis); the script repairs it rather than leaving an immortal counter.
 */
const CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

/**
 * Fixed-window counters in Redis: correct across any number of API
 * instances, with the window's TTL enforced by Redis itself.
 *
 * Same semantics as the in-memory limiter — the key names the dimension, a
 * window starts on the first hit and never slides — so the call sites and
 * their tests do not know which one they are talking to.
 */
@Injectable()
export class RedisRateLimiter extends RateLimiter {
  /** Set while Redis is failing; read by health and metrics. */
  private unavailableSince: number | null = null;

  constructor(
    private readonly redis: RedisCommands,
    private readonly options: RedisRateLimiterOptions,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  get available(): boolean {
    return this.unavailableSince === null;
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    let reply: unknown;
    try {
      reply = await this.redis.eval(CONSUME_SCRIPT, 1, this.prefixed(key), windowSeconds * 1000);
    } catch (error) {
      return this.onOutage(error);
    }
    this.recovered();

    const [count, ttlMs] = parseReply(reply);
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    if (count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefixed(key));
      this.recovered();
    } catch (error) {
      // A reset that fails only leaves a stricter limit in place; log and go on.
      this.logger.fail('Rate limiter: reset failed', error, { key });
      this.markUnavailable();
    }
  }

  async resetAll(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.options.keyPrefix}*`,
        'COUNT',
        500,
      );
      if (keys.length > 0) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.redis.ping();
      this.recovered();
      return reply === 'PONG';
    } catch {
      this.markUnavailable();
      return false;
    }
  }

  private prefixed(key: string): string {
    return `${this.options.keyPrefix}${key}`;
  }

  private onOutage(error: unknown): RateLimitResult {
    const first = this.available;
    this.markUnavailable();
    if (first)
      this.logger.fail('Rate limiter: Redis unavailable', error, {
        policy: this.options.outagePolicy,
      });

    if (this.options.outagePolicy === 'allow') {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
    }
    throw new AppError('RATE_LIMITED', 'Temporarily unavailable, try again shortly', {
      retryAfterSeconds: this.options.outageRetryAfterSeconds ?? 30,
      reason: 'rate_limiter_unavailable',
    });
  }

  private markUnavailable(): void {
    if (this.unavailableSince === null) this.unavailableSince = Date.now();
  }

  private recovered(): void {
    if (this.unavailableSince !== null) {
      this.logger.info('Rate limiter: Redis available again', {
        outageMs: Date.now() - this.unavailableSince,
      });
      this.unavailableSince = null;
    }
  }
}

function parseReply(reply: unknown): [number, number] {
  if (!Array.isArray(reply) || reply.length !== 2) {
    throw new Error('RedisRateLimiter: unexpected script reply');
  }
  const count = Number(reply[0]);
  const ttl = Number(reply[1]);
  if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
    throw new Error('RedisRateLimiter: non-numeric script reply');
  }
  return [count, ttl];
}
