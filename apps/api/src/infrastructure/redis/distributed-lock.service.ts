import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis-client.token';

/**
 * Releases only the caller's own lock. A lock that has expired and been
 * re-acquired by another replica must survive the loser's `finally` block —
 * an unconditional DEL would delete a stranger's lock instead of its own.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * A cron sweep (bonus expiry, EV session cleanup, outbox drain) is
 * idempotent by construction, but running it from two replicas at once still
 * wastes a full table scan doing nothing, and stacks retryable Postgres
 * write conflicts on top of it for free. `withLock` makes exactly one
 * replica actually do the work per tick; every other replica sees the lock
 * held and skips, which is fine — the same job runs again next tick.
 *
 * This is advisory, not authoritative: a replica that acquires the lock and
 * then blocks past the TTL can overlap with whoever acquires it next, so the
 * work under the lock must still be safe under that overlap on its own
 * merits (conditional updates, unique constraints) — the lock is a
 * concurrency *reduction*, not a substitute for it.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Runs `fn` only if this call wins the lock for `key`. Returns whether it
   * ran, so a caller that wants to distinguish "skipped" from "ran and
   * failed" can.
   */
  async withLock(key: string, ttlMs: number, fn: () => Promise<unknown>): Promise<boolean> {
    const token = randomUUID();
    const lockKey = `lock:${key}`;

    const acquired = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') {
      return false;
    }

    try {
      await fn();
      return true;
    } finally {
      try {
        await this.redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
      } catch (err) {
        // The TTL still bounds how long this can block the next tick, so a
        // failed release degrades to "wait out the TTL" rather than deadlock.
        this.logger.warn(`Failed to release lock ${lockKey}: ${(err as Error).message}`);
      }
    }
  }
}
