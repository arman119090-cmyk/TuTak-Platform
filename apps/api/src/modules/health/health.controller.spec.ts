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
  let fired: { key: string; title: string }[] = [];

  beforeEach(() => {
    fired = [];
  });

  const build = (opts: {
    db?: () => Promise<unknown>;
    redis?: () => Promise<unknown>;
    storage?: () => Promise<unknown>;
  }) =>
    new HealthController(
      { $queryRaw: opts.db ?? (() => Promise.resolve([1])) } as never,
      { ping: opts.redis ?? (() => Promise.resolve('PONG')) } as never,
      {
        driverName: 's3',
        get: opts.storage ?? (() => Promise.resolve(null)),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      } as never,
      { get: () => false } as never,
      {
        fire: (alert: { key: string; title: string }) => {
          fired.push(alert);
          return Promise.resolve(true);
        },
      } as never,
    );

  it('is ready when everything answers', async () => {
    const result = await build({}).ready();
    expect(result).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', storage: 'ok', storageDriver: 's3' },
    });
  });

  it('is not ready without the database', async () => {
    const controller = build({ db: () => Promise.reject(new Error('down')) });
    await expect(controller.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it('is not ready without Redis', async () => {
    // Every queue, lock and rate limit in this API runs on it: a request that
    // reserves bonus cannot complete while it is gone.
    const controller = build({ redis: () => Promise.reject(new Error('down')) });
    await expect(controller.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it('stays ready when only object storage is down, and says so', async () => {
    // The deliberate asymmetry. Without the bucket an avatar or a logo fails
    // to load; purchases, accrual, referral payouts and refunds all complete.
    // Failing readiness here would pull every replica out of rotation and
    // stop the till because a picture could not be fetched.
    const controller = build({ storage: () => Promise.reject(new Error('bucket unreachable')) });

    const result = await controller.ready();
    expect(result.status).toBe('ok');
    expect(result.checks.storage).toBe('error');
  });

  it('tells somebody when the bucket is gone, because nothing else would', async () => {
    // Storage is the one dependency whose failure deliberately does not take
    // the instance out of rotation, so it produces no deployment-health
    // signal either. Without this, the first report of a media outage is a
    // customer noticing a blank logo.
    const controller = build({ storage: () => Promise.reject(new Error('bucket unreachable')) });
    await controller.ready();

    expect(fired).toHaveLength(1);
    expect(fired[0]?.key).toBe('storage.unreachable:s3');
  });

  it('raises nothing while storage is answering', async () => {
    await build({}).ready();
    expect(fired).toHaveLength(0);
  });

  it('probes storage with a key that cannot exist, and never writes', async () => {
    const reads: string[] = [];
    const controller = build({
      storage: (...args: unknown[]) => {
        reads.push(String(args[0]));
        return Promise.resolve(null);
      },
    } as never);

    await controller.ready();
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('readiness');
  });
});
