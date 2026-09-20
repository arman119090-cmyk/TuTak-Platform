import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { AppConfig } from '../../config/configuration';
import { SWEEPS, SWEEPS_QUEUE } from './sweeps.jobs';

/**
 * Registers the schedule in Redis on boot, and removes anything scheduled that
 * the code no longer defines.
 *
 * `upsertJobScheduler` is idempotent on the scheduler id, so every instance
 * running this on startup converges on one schedule rather than N — which is
 * the point of the move away from in-process cron. It also means a changed
 * interval takes effect on deploy without anyone clearing Redis by hand.
 *
 * The reaper matters more than it looks. A job scheduler is a persistent row:
 * rename or delete a sweep and the old schedule keeps producing jobs forever,
 * and every one of them fails with "no sweep is defined" — noise that survives
 * deploys and outlives the person who renamed it.
 */
/**
 * How a sweep that throws is retried before it is declared failed.
 *
 * Without this BullMQ's default applied — `attempts: 0`, one try and straight
 * to failed — and on 19.09.2026 17:32 UTC a 70-second database restart made
 * `psp.process-callbacks` and `outbox.drain` "fail permanently after 0
 * attempt(s)" and page as critical. A sweep is idempotent by construction
 * (every one runs under a distributed lock and re-reads its own state), so
 * retrying is always safe; what it must not do is give up on a blip. Five
 * tries with exponential backoff from five seconds cover roughly two and a
 * half minutes — longer than any restart Railway has shown, shorter than the
 * next scheduled run of every sweep.
 */
export const SWEEP_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  // A job scheduler produces one job per tick; keep the last few outcomes for
  // the dashboard and no more, or Redis fills with a year of "completed".
  removeOnComplete: { count: 20 },
  removeOnFail: { count: 50 },
} as const;

@Injectable()
export class SweepsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SweepsScheduler.name);

  constructor(
    @InjectQueue(SWEEPS_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // An instance with sweeps off must not register the schedule either.
    // Otherwise it would fill Redis with jobs that nothing in the deployment
    // is running — which is worse than no schedule, because the queue depth
    // then looks like a backlog rather than a switched-off feature.
    if (!this.config.get('sweeps.enabled', { infer: true })) return;
    await this.sync();
  }

  /**
   * What Redis currently holds, without changing any of it.
   *
   * Separate from `sync` because the heartbeat has to be able to ask whether
   * the schedule is intact without re-applying it — see the note in
   * `SweepsHeartbeatService.repairSchedule` on why an unconditional upsert
   * would be harmful.
   */
  async listScheduled(): Promise<{ key: string }[]> {
    return this.queue.getJobSchedulers(0, -1);
  }

  /** Exposed for tests, and for anyone who needs to re-apply the schedule. */
  async sync(): Promise<void> {
    for (const sweep of SWEEPS) {
      await this.queue.upsertJobScheduler(sweep.name, sweep.repeat, {
        name: sweep.name,
        opts: SWEEP_JOB_OPTS,
      });
    }

    const defined = new Set(SWEEPS.map((sweep) => sweep.name));
    const existing = await this.listScheduled();
    for (const scheduler of existing) {
      if (scheduler.key && !defined.has(scheduler.key)) {
        await this.queue.removeJobScheduler(scheduler.key);
        this.logger.warn(`Removed orphaned job schedule '${scheduler.key}'`);
      }
    }

    this.logger.log(`${SWEEPS.length} recurring job(s) scheduled`);
  }
}
