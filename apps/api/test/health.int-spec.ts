import { HttpException } from '@nestjs/common';
import { HealthController } from '../src/modules/health/health.controller';
import { TestHarness, createTestHarness } from './setup/harness';

/**
 * The probes an orchestrator actually calls. `live` must never depend on the
 * database — a Postgres blip should not make an orchestrator kill and
 * restart a process that would otherwise recover on its own; `ready` must,
 * because that is the one load balancers use to stop routing traffic here.
 */
describe('HealthController (integration)', () => {
  let harness: TestHarness;
  let health: HealthController;

  beforeAll(async () => {
    harness = await createTestHarness();
    health = harness.app.get(HealthController);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reports live without touching any dependency', () => {
    expect(health.live()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database and Redis are both reachable', async () => {
    const result = await health.ready();
    expect(result).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('is registered outside API versioning, at a fixed path', () => {
    const path = Reflect.getMetadata('path', HealthController) as string;
    expect(path).toBe('health');
  });
});

/**
 * A dependency actually being down is exercised against a throwaway
 * controller instance rather than the shared harness — poisoning the
 * harness's real Prisma/Redis clients would break every other test file
 * that runs after this one in the same Jest worker.
 */
describe('HealthController readiness under a failing dependency', () => {
  it('reports 503 when a dependency check rejects', async () => {
    const failingController = new HealthController(
      { $queryRaw: () => Promise.reject(new Error('connection refused')) } as never,
      { ping: () => Promise.resolve('PONG') } as never,
    );

    await expect(failingController.ready()).rejects.toThrow(HttpException);
    try {
      await failingController.ready();
      throw new Error('expected ready() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(503);
      expect((err as HttpException).getResponse()).toEqual({
        status: 'error',
        checks: { database: 'error', redis: 'ok' },
      });
    }
  });
});
