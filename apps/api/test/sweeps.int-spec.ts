import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import type Redis from 'ioredis';
import configuration from '../src/config/configuration';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { REDIS_CLIENT, RedisModule } from '../src/infrastructure/redis/redis.module';
import { PrismaModule } from '../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AlertsModule } from '../src/infrastructure/alerts/alerts.module';
import { ALERT_CHANNEL } from '../src/infrastructure/alerts/alert-channel.interface';
import { SWEEPS, SWEEPS_QUEUE, SWEEP_DEPENDENCIES } from '../src/modules/sweeps/sweeps.jobs';
import { SweepsProcessor } from '../src/modules/sweeps/sweeps.processor';
import { SweepsHeartbeatService } from '../src/modules/sweeps/sweeps.heartbeat.service';
import { SweepsScheduler } from '../src/modules/sweeps/sweeps.scheduler';
import { RecordingAlertChannel } from './setup/recording-alert.channel';
import { TEST_DATABASE_URL } from './setup/test-database';

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
  let heartbeat: SweepsHeartbeatService;
  let queue: Queue;
  let prisma: PrismaClient;
  let redis: Redis;
  const alerts = new RecordingAlertChannel();

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
  const cdrs = { reconcilePending: jest.fn(record('ev.reconcile-cdrs')) };
  const accountDeletion = { anonymizeDue: jest.fn(record('account.anonymize')) };
  const retention = { prune: jest.fn(record('retention.prune')) };

  beforeAll(async () => {
    // A keyspace of this suite's own, so a run here cannot disturb the
    // schedule of a development stack sharing the same Redis.
    process.env.QUEUE_PREFIX = `tutak-test-${process.pid}`;

    prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
        PrismaModule,
        RedisModule,
        QueueModule,
        AlertsModule,
        BullModule.registerQueue({ name: SWEEPS_QUEUE }),
      ],
      providers: [
        SweepsProcessor,
        SweepsScheduler,
        SweepsHeartbeatService,
        // One stubbed bundle rather than one provider per service. The
        // production module assembles the same shape from the real services;
        // what this suite is asking is whether the dispatch reaches them.
        {
          provide: SWEEP_DEPENDENCIES,
          useValue: {
            bonus,
            reservations,
            sessions,
            outbox,
            reconciliation,
            cdrs,
            accountDeletion,
            retention,
          },
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // The real AlertsService, with delivery captured. The heartbeat's whole
      // purpose is that somebody is told, so a stubbed alerter would let this
      // suite pass while the outage stayed silent.
      .overrideProvider(ALERT_CHANNEL)
      .useValue(alerts)
      .compile();

    // No `init()`: that would fire onApplicationBootstrap and start the worker,
    // which would then race every assertion below.
    processor = moduleRef.get(SweepsProcessor);
    scheduler = moduleRef.get(SweepsScheduler);
    heartbeat = moduleRef.get(SweepsHeartbeatService);
    queue = moduleRef.get<Queue>(getQueueToken(SWEEPS_QUEUE));
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    // Leave no schedule behind in the shared Redis, then close both
    // connections by hand: the raw ioredis client has no lifecycle hook, so
    // without this jest hangs on an open handle after the last assertion.
    await queue.obliterate({ force: true }).catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await moduleRef.close();
    await prisma.$disconnect();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    calls.length = 0;
    jest.clearAllMocks();
    jest.restoreAllMocks();
    alerts.clear();
    await prisma.sweepRun.deleteMany();
    // Suppression is a Redis key with a fifteen-minute life, so without this
    // the second test to fire a given key would find its alert swallowed by
    // the first and assert on an empty list.
    const keys = await redis.keys('alert:sent:*');
    if (keys.length) await redis.del(...keys);
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

  describe('the heartbeat', () => {
    /** What a Redis restart looks like from here: the schedule is simply gone. */
    const loseTheSchedule = async () => {
      for (const scheduled of await queue.getJobSchedulers(0, -1)) {
        await queue.removeJobScheduler(scheduled.key);
      }
      expect(await queue.getJobSchedulers(0, -1)).toHaveLength(0);
    };

    it('records the run that proves a sweep is alive', async () => {
      await processor.process({ name: 'outbox.drain' } as Job);

      const row = await prisma.sweepRun.findUniqueOrThrow({ where: { name: 'outbox.drain' } });
      expect(row.didWork).toBe(true);
      expect(Date.now() - row.lastSuccessAt.getTime()).toBeLessThan(10_000);
    });

    it('records a lock-skipped run too, because the schedule still delivered a tick', async () => {
      // The distinction that matters: "another replica is doing the work" is
      // healthy, and treating it as silence would page someone about a
      // platform that is working correctly.
      const locked = SWEEPS.find((sweep) => sweep.name === 'bonus.promote-pending')!;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      bonus.promotePendingLots.mockImplementationOnce(() => held);

      const first = processor.process({ name: locked.name } as Job);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await processor.process({ name: locked.name } as Job);
      expect(second.ran).toBe(false);
      release();
      await first;

      const row = await prisma.sweepRun.findUniqueOrThrow({ where: { name: locked.name } });
      expect(row.lastSuccessAt).toBeInstanceOf(Date);
    });

    it('restores a schedule that Redis has lost', async () => {
      // The failure the whole heartbeat exists for. Nothing fails when this
      // happens: no job errors, no queue backs up, the API keeps answering.
      // Every sweep just stops, and the first symptom is a customer noticing
      // their points never arrived.
      await scheduler.sync();
      await loseTheSchedule();

      await heartbeat.tick();

      const restored = (await queue.getJobSchedulers(0, -1)).map((s) => s.key).sort();
      expect(restored).toEqual(SWEEPS.map((s) => s.name).sort());
    });

    it('says so when it has had to restore one', async () => {
      await scheduler.sync();
      await loseTheSchedule();

      await heartbeat.tick();

      // Self-healing silently would hide that Redis lost data, which is a
      // fact about the deployment that outlives this particular repair.
      const fired = alerts.matching('sweeps.schedule-lost');
      expect(fired).toHaveLength(1);
      expect(fired[0]!.severity).toBe('critical');
      expect(fired[0]!.context?.count).toBe(SWEEPS.length);
    });

    it('leaves a healthy schedule completely alone', async () => {
      // Not a tidiness assertion. `upsertJobScheduler` re-anchors a
      // scheduler's next run, so a heartbeat that re-applied the schedule
      // every minute would push a five-minute sweep's next tick forward
      // every minute and it would never fire — the repair mechanism causing
      // the outage it exists to fix.
      await scheduler.sync();
      const sync = jest.spyOn(scheduler, 'sync');

      await heartbeat.tick();
      await heartbeat.tick();

      expect(sync).not.toHaveBeenCalled();
      expect(alerts.matching('sweeps.schedule-lost')).toHaveLength(0);
    });

    it('alerts on a sweep that has gone quiet for longer than its own tolerance', async () => {
      const sweep = SWEEPS.find((s) => s.name === 'outbox.drain')!;
      await scheduler.sync();
      await prisma.sweepRun.create({
        data: {
          name: sweep.name,
          // Just past its tolerance, not wildly past: the boundary is where
          // an off-by-one would hide.
          lastSuccessAt: new Date(Date.now() - sweep.maxSilenceMs - 1_000),
          lastDurationMs: 12,
        },
      });

      await heartbeat.tick();

      const fired = alerts.matching(`sweep.silent:${sweep.name}`);
      expect(fired).toHaveLength(1);
      // The operator reading this at 3am needs the consequence, not the
      // queue mechanics.
      expect(fired[0]!.body).toContain(sweep.why);
    });

    it('stays quiet about a sweep that completed within its tolerance', async () => {
      await scheduler.sync();
      for (const sweep of SWEEPS) {
        await prisma.sweepRun.create({
          data: { name: sweep.name, lastSuccessAt: new Date(), lastDurationMs: 5 },
        });
      }

      await heartbeat.tick();

      expect(alerts.matching('sweep.silent')).toHaveLength(0);
    });

    it('does not cry wolf on a fresh deployment that has never run anything', async () => {
      // Every sweep has zero recorded runs here. Alerting on that would mean
      // seven critical pages on every first boot, which is how an operator
      // learns to ignore this channel.
      await scheduler.sync();
      expect(await prisma.sweepRun.count()).toBe(0);

      await heartbeat.tick();

      expect(alerts.matching('sweep.silent')).toHaveLength(0);
    });

    it('gives every sweep a tolerance longer than its own interval', () => {
      // A tolerance below the repeat interval would alert on a perfectly
      // healthy job every single tick.
      for (const sweep of SWEEPS) {
        if ('every' in sweep.repeat) {
          expect(sweep.maxSilenceMs).toBeGreaterThan(sweep.repeat.every);
        } else {
          // The nightly job: anything under a day is guaranteed noise.
          expect(sweep.maxSilenceMs).toBeGreaterThan(24 * 60 * 60_000);
        }
      }
    });

    it('keeps a sweep succeeding even when the heartbeat row cannot be written', async () => {
      // The work is already committed by the time the row is written. A throw
      // here would fail the job, BullMQ would retry it, and real financial
      // work would be repeated because bookkeeping about that work did not
      // land.
      jest
        .spyOn(prisma.sweepRun, 'upsert')
        .mockRejectedValueOnce(new Error('relation "sweep_runs" does not exist'));

      const result = await processor.process({ name: 'outbox.drain' } as Job);

      expect(result.ran).toBe(true);
      expect(outbox.drain).toHaveBeenCalledTimes(1);
    });
  });
});
