import { PrismaClient } from '@prisma/client';
import { DistributedLockService } from '../src/infrastructure/redis/distributed-lock.service';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.module';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What H-3 fixes: two API replicas both run the same @Cron schedule, so a
 * sweep that used to run unconditionally ran twice — once per replica, every
 * tick. The tests below reproduce that by calling `withLock` concurrently
 * from what stands in for two replicas and proving only one of them actually
 * executes the guarded work.
 */
describe('DistributedLockService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let lock: DistributedLockService;
  let redis: import('ioredis').default;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    lock = harness.app.get(DistributedLockService);
    redis = harness.app.get(REDIS_CLIENT);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await redis.flushdb();
  });

  it('runs the guarded work exactly once when two replicas race the same tick', async () => {
    let runs = 0;
    const work = async () => {
      runs += 1;
      // Hold the lock long enough that a second, unlocked caller would
      // otherwise land in the middle of this "sweep".
      await new Promise((resolve) => setTimeout(resolve, 100));
    };

    const [a, b] = await Promise.all([
      lock.withLock('cron:test:sweep', 5000, work),
      lock.withLock('cron:test:sweep', 5000, work),
    ]);

    expect(runs).toBe(1);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('lets the next tick acquire the lock once the previous run releases it', async () => {
    let runs = 0;
    const work = () => {
      runs += 1;
      return Promise.resolve();
    };

    const first = await lock.withLock('cron:test:sequential', 5000, work);
    const second = await lock.withLock('cron:test:sequential', 5000, work);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(runs).toBe(2);
  });

  it('does not release a lock it does not own', async () => {
    // Simulates a replica whose run outlived the TTL: the lock expired and a
    // second replica already claimed it before the first one's `finally`
    // runs. The first replica's release must not delete the second
    // replica's still-live lock.
    const acquired = await redis.set('lock:cron:test:stolen', 'someone-elses-token', 'PX', 5000, 'NX');
    expect(acquired).toBe('OK');

    let ran = false;
    const won = await lock.withLock('cron:test:stolen', 5000, () => {
      ran = true;
      return Promise.resolve();
    });

    expect(won).toBe(false);
    expect(ran).toBe(false);
    // The other replica's lock must still be standing.
    expect(await redis.get('lock:cron:test:stolen')).toBe('someone-elses-token');
  });

  it('propagates the error from the guarded work and still releases the lock', async () => {
    await expect(
      lock.withLock('cron:test:failing', 5000, () => Promise.reject(new Error('sweep blew up'))),
    ).rejects.toThrow('sweep blew up');

    // A failed run must not wedge the lock for the rest of its TTL — the
    // next tick should be able to try again immediately.
    expect(await redis.get('lock:cron:test:failing')).toBeNull();
  });
});
