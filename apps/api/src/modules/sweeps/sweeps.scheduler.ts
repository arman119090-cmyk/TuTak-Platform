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

  /** Exposed for tests, and for anyone who needs to re-apply the schedule. */
  async sync(): Promise<void> {
    for (const sweep of SWEEPS) {
      await this.queue.upsertJobScheduler(sweep.name, sweep.repeat, { name: sweep.name });
    }

    const defined = new Set(SWEEPS.map((sweep) => sweep.name));
    const existing = await this.queue.getJobSchedulers(0, -1);
    for (const scheduler of existing) {
      if (scheduler.key && !defined.has(scheduler.key)) {
        await this.queue.removeJobScheduler(scheduler.key);
        this.logger.warn(`Removed orphaned job schedule '${scheduler.key}'`);
      }
    }

    this.logger.log(`${SWEEPS.length} recurring job(s) scheduled`);
  }
}
