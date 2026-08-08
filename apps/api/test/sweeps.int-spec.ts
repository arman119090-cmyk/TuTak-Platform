import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Job, Queue } from 'bullmq';
import type Redis from 'ioredis';
import configuration from '../src/config/configuration';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { REDIS_CLIENT, RedisModule } from '../src/infrastructure/redis/redis.module';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { EvReservationsService } from '../src/modules/ev-charging/ev-reservations.service';
import { EvSessionsService } from '../src/modules/ev-charging/ev-sessions.service';
import { OutboxService } from '../src/modules/ledger/outbox.service';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { SWEEPS, SWEEPS_QUEUE } from '../src/modules/sweeps/sweeps.jobs';
import { SweepsProcessor } from '../src/modules/sweeps/sweeps.processor';
import { AlertsService } from '../src/infrastructure/alerts/alerts.service';
import { SweepsScheduler } from '../src/modules/sweeps/sweeps.scheduler';

/**
 * The recurring-work machinery, against a real Redis.
 *
 * The sweeps used to be `@Cron` methods with no tests at all — a gap that
 * mattered, because a sweep is the only thing standing between a customer and
 * points that never arrive, and nothing in a request path would ever notice it
 * had stopped. What is checked here is the machinery rather than the domain
 * work (which has its own suites): that every scheduled job has a handler, that
 * the handler is reached, that a stale schedule is reaped, and that two workers
 * cannot sweep the same table at once.
 *
 * The domain services are stubbed on purpose. Whether `expireLots` expires the
 * right lots is `bonus-engine.int-spec.ts`'s question; whether anything ever
 * calls it is this one's.
 */
describe('Sweeps (integration)', () => {
  let moduleRef: TestingModule;
  let processor: SweepsProcessor;
  let scheduler: SweepsScheduler;
  let queue: Queue;

  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };

  const bonus = {
    promotePendingLots: jest.fn(record('bonus.promote')),
    expireLots: jest.fn(record('bonus.expire')),
    releaseExpiredReservations: jest.fn(record('bonus.release')),
  };
  const reservations = { expireStaleReservations: jest.fn(record('ev.reservations')) };
  const sessions = { expireStaleSessions: jest.fn(record('ev.sessions')) };
  const outbox = { drain: jest.fn(record('outbox.drain')) };
  // Typed so the period assertion below can read the argument it was called
  // with rather than casting it back out of `unknown`.
  const reconciliation = {
    reconcile: jest.fn((_params: { periodStart: Date }) => record('reconciliation')()),
  };

  beforeAll(async () => {
    // A keyspace of this suite's own, so a run here cannot disturb the
    // schedule of a development stack sharing the same Redis.
    process.env.QUEUE_PREFIX = `tutak-test-${process.pid}`;

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
        RedisModule,
        QueueModule,
        BullModule.registerQueue({ name: SWEEPS_QUEUE }),
      ],
      providers: [
        SweepsProcessor,
        SweepsScheduler,
        { provide: BonusEngineService, useValue: bonus },
        { provide: EvReservationsService, useValue: reservations },
        { provide: EvSessionsService, useValue: sessions },
        { provide: OutboxService, useValue: outbox },
        { provide: ReconciliationService, useValue: reconciliation },
        // The processor alerts when a job stops retrying. This suite is
        // about scheduling and dispatch, so a recorder is enough — the
        // alerting behaviour itself is covered in alerting.int-spec.ts.
        { provide: AlertsService, useValue: { fire: jest.fn() } },
      ],
    }).compile();

    // No `init()`: that would fire onApplicationBootstrap and start the worker,
    // which would then race every assertion below.
    processor = moduleRef.get(SweepsProcessor);
    scheduler = moduleRef.get(SweepsScheduler);
    queue = moduleRef.get<Queue>(getQueueToken(SWEEPS_QUEUE));
  });

  afterAll(async () => {
    // Leave no schedule behind in the shared Redis, then close both
    // connections by hand: the raw ioredis client has no lifecycle hook, so
    // without this jest hangs on an open handle after the last assertion.
    await queue.obliterate({ force: true }).catch(() => undefined);
    await moduleRef.get<Redis>(REDIS_CLIENT).quit().catch(() => undefined);
    await moduleRef.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
  });

  describe('the job table', () => {
    it('gives every job a unique name', () => {
      const names = SWEEPS.map((sweep) => sweep.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('gives every job a schedule and a reason for existing', () => {
      for (const sweep of SWEEPS) {
        // A row with neither `every` nor `pattern` would be accepted by BullMQ
        // and then simply never fire.
        const scheduled =
          ('every' in sweep.repeat && sweep.repeat.every > 0) ||
          ('pattern' in sweep.repeat && sweep.repeat.pattern.length > 0);
        expect(scheduled).toBe(true);
        // Not decoration: the next person to consider deleting one of these
        // needs to know what breaks if they do.
        expect(sweep.why.length).toBeGreaterThan(40);
      }
    });
  });

  describe('the processor', () => {
    it('reaches the real handler for every scheduled job', async () => {
      // The failure this catches is a job scheduled under a name nothing
      // dispatches on — which fails silently forever, since a schedule that
      // produces failing jobs still produces jobs.
      for (const sweep of SWEEPS) {
        const result = await processor.process({ name: sweep.name } as Job);
        expect(result.ran).toBe(true);
      }

      expect(calls).toHaveLength(SWEEPS.length);
      expect(bonus.promotePendingLots).toHaveBeenCalledTimes(1);
      expect(bonus.expireLots).toHaveBeenCalledTimes(1);
      expect(bonus.releaseExpiredReservations).toHaveBeenCalledTimes(1);
      expect(reservations.expireStaleReservations).toHaveBeenCalledTimes(1);
      expect(sessions.expireStaleSessions).toHaveBeenCalledTimes(1);
      expect(outbox.drain).toHaveBeenCalledTimes(1);
      expect(reconciliation.reconcile).toHaveBeenCalledTimes(1);
    });

    it('reconciles yesterday, not today', async () => {
      await processor.process({ name: 'reconciliation.nightly' } as Job);

      const { periodStart } = reconciliation.reconcile.mock.calls[0]![0];
      expect(periodStart.getTime()).toBeLessThan(Date.now());
      // Yesterday's local midnight is between 24 and 48 hours back, never less:
      // a period that included today would reconcile a day still in progress.
      const hoursAgo = (Date.now() - periodStart.getTime()) / 3_600_000;
      expect(hoursAgo).toBeGreaterThanOrEqual(24);
      expect(hoursAgo).toBeLessThan(48);
    });

    it('fails loudly on a job name it does not define', async () => {
      // What a renamed sweep leaves behind in Redis. Succeeding quietly here
      // would hide the orphan until someone wondered why nothing ran.
      await expect(processor.process({ name: 'sweep.that.was.deleted' } as Job)).rejects.toThrow(
        /No sweep is defined/,
      );
    });

    it('lets a failing sweep fail the job instead of swallowing it', async () => {
      // The entire reason for leaving @nestjs/schedule: a cron that threw
      // logged one line and the tick was gone. A failed job keeps its stack
      // trace and its attempt count in Redis.
      outbox.drain.mockRejectedValueOnce(new Error('postgres is unreachable'));
      await expect(processor.process({ name: 'outbox.drain' } as Job)).rejects.toThrow(
        'postgres is unreachable',
      );
    });

    it('skips a locked sweep rather than running it twice at once', async () => {
      const locked = SWEEPS.find((sweep) => sweep.lockTtlMs !== null)!;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      // Stand in for another worker still inside the previous tick.
      bonus.promotePendingLots.mockImplementationOnce(() => held);
      reservations.expireStaleReservations.mockImplementationOnce(() => held);
      sessions.expireStaleSessions.mockImplementationOnce(() => held);
      bonus.expireLots.mockImplementationOnce(() => held);
      bonus.releaseExpiredReservations.mockImplementationOnce(() => held);
      reconciliation.reconcile.mockImplementationOnce(() => held);

      const first = processor.process({ name: locked.name } as Job);
      // Long enough for the first call to have taken the lock, short enough
      // not to matter if it was slower than that — the assertion is on the
      // second call's result, not on timing.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await processor.process({ name: locked.name } as Job);

      expect(second.ran).toBe(false);
      release();
      expect((await first).ran).toBe(true);
    });

    it('lets the outbox drain overlap, because that is how a backlog clears', async () => {
      // The one sweep with no lock. Two drainers claim different events with
      // `FOR UPDATE SKIP LOCKED`, so a second one arriving mid-drain is extra
      // capacity rather than contention.
      const drain = SWEEPS.find((sweep) => sweep.name === 'outbox.drain')!;
      expect(drain.lockTtlMs).toBeNull();

      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      outbox.drain.mockImplementationOnce(() => held);

      const first = processor.process({ name: 'outbox.drain' } as Job);
      const second = await processor.process({ name: 'outbox.drain' } as Job);

      expect(second.ran).toBe(true);
      expect(outbox.drain).toHaveBeenCalledTimes(2);
      release();
      await first;
    });
  });

  describe('the scheduler', () => {
    it('registers exactly the defined jobs, and is safe to run twice', async () => {
      await scheduler.sync();
      await scheduler.sync();

      const registered = await queue.getJobSchedulers(0, -1);
      expect(registered.map((s) => s.key).sort()).toEqual(SWEEPS.map((s) => s.name).sort());
    });

    it('reaps a schedule whose job no longer exists', async () => {
      // A rename leaves the old scheduler row behind, producing jobs forever
      // that fail with "no sweep is defined" — noise that survives deploys.
      await queue.upsertJobScheduler('sweep.removed.last.release', { every: 60_000 });
      expect((await queue.getJobSchedulers(0, -1)).map((s) => s.key)).toContain(
        'sweep.removed.last.release',
      );

      await scheduler.sync();

      expect((await queue.getJobSchedulers(0, -1)).map((s) => s.key)).not.toContain(
        'sweep.removed.last.release',
      );
    });
  });
});
