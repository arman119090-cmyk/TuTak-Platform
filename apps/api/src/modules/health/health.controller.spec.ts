import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * What readiness is allowed to fail on.
 *
 * A readiness probe answers one question for a load balancer: can this
 * instance serve a request right now. Getting that wrong in either direction
 * is expensive — green while the database is gone sends customers into
 * errors; red over something cosmetic takes a working till offline.
 */
describe('HealthController readiness', () => {
  const build = (opts: {
    db?: () => Promise<unknown>;
    redis?: () => Promise<unknown>;
    storage?: () => Promise<unknown>;
  }) =>
    new HealthController(
      { $queryRaw: opts.db ?? (async () => [1]) } as never,
      { ping: opts.redis ?? (async () => 'PONG') } as never,
      {
        driverName: 's3',
        get: opts.storage ?? (async () => null),
        put: async () => undefined,
        delete: async () => undefined,
      } as never,
      { get: () => false } as never,
    );

  it('is ready when everything answers', async () => {
    const result = await build({}).ready();
    expect(result).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', storage: 'ok', storageDriver: 's3' },
    });
  });

  it('is not ready without the database', async () => {
    const controller = build({ db: async () => { throw new Error('down'); } });
    await expect(controller.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it('is not ready without Redis', async () => {
    // Every queue, lock and rate limit in this API runs on it: a request that
    // reserves bonus cannot complete while it is gone.
    const controller = build({ redis: async () => { throw new Error('down'); } });
    await expect(controller.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it('stays ready when only object storage is down, and says so', async () => {
    // The deliberate asymmetry. Without the bucket an avatar or a logo fails
    // to load; purchases, accrual, referral payouts and refunds all complete.
    // Failing readiness here would pull every replica out of rotation and
    // stop the till because a picture could not be fetched.
    const controller = build({ storage: async () => { throw new Error('bucket unreachable'); } });

    const result = await controller.ready();
    expect(result.status).toBe('ok');
    expect(result.checks.storage).toBe('error');
  });

  it('probes storage with a key that cannot exist, and never writes', async () => {
    const reads: string[] = [];
    const controller = build({
      storage: async (...args: unknown[]) => {
        reads.push(String(args[0]));
        return null;
      },
    } as never);

    await controller.ready();
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('readiness');
  });
});
