import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { AppConfig } from '../../config/configuration';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { EvReservationsService } from '../ev-charging/ev-reservations.service';
import { EvSessionsService } from '../ev-charging/ev-sessions.service';
import { OutboxService } from '../ledger/outbox.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { SWEEPS_QUEUE, SweepDependencies, findSweep } from './sweeps.jobs';

export interface SweepResult {
  /** False when another worker held the lock — not a failure, just nothing to do. */
  ran: boolean;
  ms: number;
}

/**
 * Runs the jobs in `SWEEPS`, one worker per instance.
 *
 * Unlike the `@Cron` methods this replaces, a throw here is not swallowed: it
 * fails the job, which records the stack trace against the job in Redis and
 * lets BullMQ retry it. That is the whole reason for the move — a sweep that
 * has been failing for a week used to look exactly like a sweep that has been
 * working for a week.
 */
@Processor(SWEEPS_QUEUE, {
  // Four at a time. The sweeps are independent of each other, and serial
  // processing would let the nightly reconciliation — which replays every
  // posting — hold up the outbox drain for as long as it takes.
  concurrency: 4,
  // Started explicitly on bootstrap so `SWEEPS_ENABLED=false` yields a process
  // that never picks a job up, rather than one that picks jobs up and drops
  // them.
  autorun: false,
})
export class SweepsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SweepsProcessor.name);
  private readonly deps: SweepDependencies;

  constructor(
    bonus: BonusEngineService,
    reservations: EvReservationsService,
    sessions: EvSessionsService,
    outbox: OutboxService,
    reconciliation: ReconciliationService,
    private readonly lock: DistributedLockService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly alerts: AlertsService,
    private readonly prisma: PrismaService,
  ) {
    super();
    this.deps = { bonus, reservations, sessions, outbox, reconciliation };
  }

  onApplicationBootstrap(): void {
    if (this.config.get('sweeps.enabled', { infer: true })) {
      void this.worker.run();
    }
  }

  async process(job: Job): Promise<SweepResult> {
    const sweep = findSweep(job.name);
    if (!sweep) {
      // A scheduler row in Redis outlived the code that defined it. Failing
      // loudly beats silently succeeding: the reaper in SweepsScheduler will
      // remove the schedule on the next boot, and until then this is the only
      // signal that something is scheduled which no longer exists.
      throw new Error(`No sweep is defined for job '${job.name}'`);
    }

    const began = Date.now();
    let ran = true;
    if (sweep.lockTtlMs === null) {
      await sweep.run(this.deps);
    } else {
      ran = await this.lock.withLock(`sweep:${sweep.name}`, sweep.lockTtlMs, () =>
        sweep.run(this.deps),
      );
    }
    const ms = Date.now() - began;

    if (!ran) {
      this.logger.debug(`${sweep.name} skipped — another worker holds the lock`);
    }

    await this.recordSuccess(sweep.name, ms, ran);
    return { ran, ms };
  }

  /**
   * Writes the heartbeat row this sweep's liveness is judged by.
   *
   * A lock-skipped run is still recorded, and that is deliberate: the
   * question this row answers is "is the schedule still delivering ticks",
   * not "did this particular worker do the work". A busy platform where
   * another replica holds every lock is healthy; a platform where no tick
   * arrives at all is the outage.
   *
   * Failing to record must never fail the sweep. The work is already done and
   * committed by this point — throwing here would fail the job, retry it, and
   * repeat real financial work because bookkeeping about that work did not
   * land. Losing one heartbeat only shortens the window before the next one.
   */
  private async recordSuccess(name: string, ms: number, didWork: boolean): Promise<void> {
    try {
      await this.prisma.sweepRun.upsert({
        where: { name },
        create: { name, lastSuccessAt: new Date(), lastDurationMs: ms, didWork },
        update: { lastSuccessAt: new Date(), lastDurationMs: ms, didWork },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record the heartbeat for '${name}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Fires when BullMQ has finished retrying and the job is staying failed.
   *
   * This is the alert that covers everything the other two do not. Bonus
   * expiry, EV session cleanup, the outbox drain and reconciliation all run
   * here, and a sweep that has been failing for a week used to look exactly
   * like a sweep that had been working for a week — which is the entire
   * reason these moved off in-process cron. Now the silence has a voice.
   *
   * `attemptsMade` is compared against the job's own configured maximum
   * rather than a constant: BullMQ emits `failed` on every attempt, and
   * alerting on the first of five retries would page someone about a
   * transient database blip that fixed itself nine seconds later.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    if (!job) return;

    const max = job.opts.attempts ?? 1;
    if (job.attemptsMade < max) {
      this.logger.warn(
        `${job.name} failed on attempt ${job.attemptsMade}/${max}, will retry: ${error.message}`,
      );
      return;
    }

    this.logger.error(`${job.name} failed permanently after ${max} attempt(s): ${error.message}`);

    await this.alerts.fire({
      severity: 'critical',
      key: `sweep.failed:${job.name}`,
      title: `Background job '${job.name}' is failing`,
      body:
        `It has failed ${max} time(s) and stopped retrying. Depending on the job this means ` +
        'bonuses are not expiring, charging sessions are not being closed, ledger events are ' +
        'not settling, or nothing is being reconciled.',
      context: { job: job.name, attempts: max, error: error.message.slice(0, 200) },
    });
  }
}
