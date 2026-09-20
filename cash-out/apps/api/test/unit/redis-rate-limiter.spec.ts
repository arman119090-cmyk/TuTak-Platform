import Redis from 'ioredis';
import { AppError } from '../../src/common/app-error';
import { AppLogger } from '../../src/common/logging/logger.service';
import { RedisCommands, RedisRateLimiter } from '../../src/common/rate-limit/redis-rate-limiter';
import { testEnv } from '../harness';

/**
 * An in-memory stand-in that executes the limiter's one script faithfully:
 * INCR, PEXPIRE on first hit, PTTL. Time is a number the test moves. It is
 * enough to prove the limiter's logic; the real-Redis block below proves the
 * script itself.
 */
class FakeRedis implements RedisCommands {
  now = 1_000_000;
  failing = false;
  readonly store = new Map<string, { count: number; expiresAt: number }>();

  async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    if (this.failing) throw new Error('ECONNREFUSED');
    const key = String(args[0]);
    const windowMs = Number(args[1]);
    const existing = this.store.get(key);
    if (!existing || existing.expiresAt <= this.now) {
      this.store.set(key, { count: 1, expiresAt: this.now + windowMs });
      return [1, windowMs];
    }
    existing.count += 1;
    return [existing.count, existing.expiresAt - this.now];
  }

  async del(...keys: string[]): Promise<number> {
    if (this.failing) throw new Error('ECONNREFUSED');
    let n = 0;
    for (const key of keys) if (this.store.delete(key)) n += 1;
    return n;
  }

  async scan(_cursor: string, _m: 'MATCH', pattern: string): Promise<[string, string[]]> {
    const prefix = pattern.replace(/\*$/, '');
    return ['0', [...this.store.keys()].filter((key) => key.startsWith(prefix))];
  }

  async ping(): Promise<string> {
    if (this.failing) throw new Error('ECONNREFUSED');
    return 'PONG';
  }
}

const logger = new AppLogger(testEnv());

describe('RedisRateLimiter', () => {
  let redis: FakeRedis;
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    redis = new FakeRedis();
    limiter = new RedisRateLimiter(redis, { keyPrefix: 't:', outagePolicy: 'deny' }, logger);
  });

  it('allows up to the limit in a window, then refuses with a Retry-After, and never resets on a hit', async () => {
    for (let i = 1; i <= 3; i += 1) {
      const result = await limiter.consume('otp:phone:+37491', 3, 60);
      expect(result).toEqual({ allowed: true, remaining: 3 - i, retryAfterSeconds: 0 });
    }
    const denied = await limiter.consume('otp:phone:+37491', 3, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(60);

    redis.now += 30_000;
    const still = await limiter.consume('otp:phone:+37491', 3, 60);
    expect(still.allowed).toBe(false);
    expect(still.retryAfterSeconds).toBe(30);

    redis.now += 30_000;
    expect((await limiter.consume('otp:phone:+37491', 3, 60)).allowed).toBe(true);
  });

  it('keeps dimensions apart: one phone, one IP, one driver, one admin email', async () => {
    await limiter.consume('otp:phone:+37491', 1, 60);
    expect((await limiter.consume('otp:phone:+37491', 1, 60)).allowed).toBe(false);
    expect((await limiter.consume('otp:phone:+37492', 1, 60)).allowed).toBe(true);
    expect((await limiter.consume('otp:ip:1.2.3.4', 1, 60)).allowed).toBe(true);
    expect((await limiter.consume('authorize:driver:d1', 1, 60)).allowed).toBe(true);
    expect((await limiter.consume('admin-login:a@b.c', 1, 60)).allowed).toBe(true);
    expect([...redis.store.keys()].every((key) => key.startsWith('t:'))).toBe(true);
  });

  it('reset clears one key; resetAll clears only this prefix', async () => {
    await limiter.consume('a', 1, 60);
    await limiter.consume('b', 1, 60);
    redis.store.set('other:c', { count: 5, expiresAt: redis.now + 1000 });
    await limiter.reset('a');
    expect((await limiter.consume('a', 1, 60)).allowed).toBe(true);
    await limiter.resetAll();
    expect(redis.store.has('t:b')).toBe(false);
    expect(redis.store.has('other:c')).toBe(true);
  });

  it('enforce throws RATE_LIMITED with the retry hint', async () => {
    await limiter.enforce('k', 1, 60);
    await expect(limiter.enforce('k', 1, 60)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 60 },
    });
  });

  describe('when Redis is down', () => {
    it('deny policy refuses with RATE_LIMITED and a short retry, and reports unavailability', async () => {
      redis.failing = true;
      await expect(limiter.consume('k', 5, 60)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: 30, reason: 'rate_limiter_unavailable' },
      });
      expect(limiter.available).toBe(false);
      expect(await limiter.ping()).toBe(false);

      redis.failing = false;
      expect((await limiter.consume('k', 5, 60)).allowed).toBe(true);
      expect(limiter.available).toBe(true);
    });

    it('allow policy lets requests through, unlimited, and still reports unavailability', async () => {
      const lenient = new RedisRateLimiter(
        redis,
        { keyPrefix: 't:', outagePolicy: 'allow' },
        logger,
      );
      redis.failing = true;
      for (let i = 0; i < 10; i += 1) {
        expect((await lenient.consume('k', 1, 60)).allowed).toBe(true);
      }
      expect(lenient.available).toBe(false);
    });

    it('a failed reset does not throw into the request path', async () => {
      redis.failing = true;
      await expect(limiter.reset('k')).resolves.toBeUndefined();
    });

    it('the thrown error is an AppError the filter can render', async () => {
      redis.failing = true;
      await expect(limiter.consume('k', 5, 60)).rejects.toBeInstanceOf(AppError);
    });
  });
});

/**
 * Against a real Redis when one is configured (CI provides it): the Lua
 * script's atomicity and TTL semantics are Redis's, not the fake's.
 */
const REDIS_URL = process.env.TEST_REDIS_URL;
(REDIS_URL ? describe : describe.skip)('RedisRateLimiter against a real Redis', () => {
  let client: Redis;
  let limiter: RedisRateLimiter;

  beforeAll(() => {
    client = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
    limiter = new RedisRateLimiter(
      client,
      { keyPrefix: `cashout-test:${process.pid}:`, outagePolicy: 'deny' },
      logger,
    );
  });

  afterAll(async () => {
    await limiter.resetAll();
    await client.quit();
  });

  beforeEach(async () => {
    await limiter.resetAll();
  });

  it('counts atomically under concurrency: exactly `limit` of N parallel hits pass', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => limiter.consume('concurrent', 7, 60)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
    expect(results.filter((r) => !r.allowed)).toHaveLength(43);
  });

  it('expires the window by TTL', async () => {
    await limiter.consume('ttl', 1, 1);
    expect((await limiter.consume('ttl', 1, 1)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await limiter.consume('ttl', 1, 1)).allowed).toBe(true);
  });

  it('pings', async () => {
    expect(await limiter.ping()).toBe(true);
  });
});
