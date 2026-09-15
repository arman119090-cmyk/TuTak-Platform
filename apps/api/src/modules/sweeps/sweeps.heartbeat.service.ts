import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SWEEPS } from './sweeps.jobs';
import { SweepsScheduler } from './sweeps.scheduler';

/** How often the heartbeat looks. One minute is under every tolerance in SWEEPS. */
const TICK_MS = 60_000;

/**
 * Watches the thing that watches everything else.
 *
 * The whole recurring-work design rests on one assumption that nothing was
 * checking: that the schedule still exists. BullMQ keeps job schedulers as
 * rows in Redis, and Redis is the one store in this stack that is allowed to
 * lose data — it is configured as a cache, an eviction or a restart without
 * persistence drops the keyspace, and a failover promotes a replica that may
 * be seconds behind. When that happens every sweep simply stops. Nothing
 * fails, nothing retries, no job appears in the failed set, and the API keeps
 * serving traffic normally. Settlement stops, points stop becoming spendable,
 * charging bays stay held — and the first symptom is a customer complaint
 * days later.
 *
 * Two independent defences, because they fail differently:
 *
 *  - **Repair.** Every tick, compare the schedulers Redis holds against
 *    `SWEEPS`. If any are missing, re-apply the schedule. This is what makes
 *    a Redis restart self-healing instead of an outage that waits for a
 *    deploy.
 *  - **Detect.** Every tick, compare each sweep's last recorded completion
 *    against its own `maxSilenceMs` and alert on anything overdue. Repair
 *    covers the failure mode we know about; detection covers the ones we do
 *    not, including a worker that is alive but wedged, and repair itself
 *    being broken.
 *
 * Deliberately an in-process `setInterval` rather than another sweep. A
 * BullMQ job cannot be the thing that restores BullMQ's schedule: the exact
 * failure it exists to repair would have removed it too. This is the one
 * timer in the codebase that is allowed to be per-instance, and it is cheap
 * enough — one small read of the schedule and one indexed table scan of at
 * most seven rows per minute — that N replicas doing it is fine. The alert
 * suppression window in `AlertsService` is shared through Redis, so N
 * replicas noticing the same silence still produce one notification.
 */
@Injectable()
export class SweepsHeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SweepsHeartbeatService.name);
  private timer?: NodeJS.Timeout;

  /**
   * When this instance started.
   *
   * Used as the fallback "last success" for a sweep that has never recorded
   * one, so a fresh database does not alert on seven overdue sweeps a second
   * after boot. The consequence is that a brand-new deployment stays quiet
   * for one full tolerance window per sweep before it will complain, which is
   * correct: until then there has been no opportunity to be late.
   */
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SweepsScheduler,
    private readonly alerts: AlertsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('sweeps.enabled', { infer: true })) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    // Node keeps the process alive for a pending timer, which would hold a
    // test run or a graceful shutdown open for up to a minute.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: repair the schedule if it is gone, then report anything overdue. */
  async tick(): Promise<void> {
    try {
      await this.repairSchedule();
    } catch (err) {
      this.logger.error(
        `Could not verify the sweep schedule: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.reportSilence();
    } catch (err) {
      this.logger.error(
        `Could not check sweep liveness: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Re-applies the schedule when Redis has lost part or all of it.
   *
   * Reads first and only writes when something is actually missing, rather
   * than upserting unconditionally. An upsert re-anchors a scheduler's next
   * run, so a timer that re-upserted more often than a sweep's own interval
   * would push that sweep's next tick forward every minute and it would never
   * fire again — a repair mechanism that causes the outage it exists to fix.
   * In the healthy case this method performs one read and no writes.
   */
  private async repairSchedule(): Promise<void> {
    const present = new Set(
      (await this.scheduler.listScheduled()).map((scheduler) => scheduler.key).filter(Boolean),
    );
    const missing = SWEEPS.filter((sweep) => !present.has(sweep.name));
    if (missing.length === 0) return;

    this.logger.error(
      `${missing.length} sweep schedule(s) missing from Redis (${missing
        .map((sweep) => sweep.name)
        .join(', ')}) — re-applying.`,
    );
    await this.scheduler.sync();

    await this.alerts.fire({
      severity: 'critical',
      key: 'sweeps.schedule-lost',
      title: 'The background job schedule disappeared from Redis',
      body:
        'Recurring jobs are stored in Redis, and some or all of them were gone. They have been ' +
        're-applied automatically, so this is a report rather than a request — but it means ' +
        'Redis lost data, and every sweep was stopped for the period between the loss and now. ' +
        'Check whether persistence is configured and whether anything else depended on that state.',
      context: { missing: missing.map((sweep) => sweep.name).join(', '), count: missing.length },
    });
  }

  /**
   * Alerts on any sweep that has not completed within its own tolerance.
   *
   * The tolerances live on the definitions in `sweeps.jobs.ts` rather than
   * being derived from the repeat interval, because a job that runs every ten
   * seconds and one that runs nightly want very different patience.
   */
  private async reportSilence(): Promise<void> {
    const rows = await this.prisma.sweepRun.findMany();
    const lastSuccess = new Map(rows.map((row) => [row.name, row.lastSuccessAt.getTime()]));
    const now = Date.now();

    for (const sweep of SWEEPS) {
      const last = lastSuccess.get(sweep.name) ?? this.startedAt;
      const silentMs = now - last;
      if (silentMs <= sweep.maxSilenceMs) continue;

      const everRan = lastSuccess.has(sweep.name);
      this.logger.error(
        `${sweep.name} has not completed for ${Math.round(silentMs / 60_000)} minute(s)`,
      );

      await this.alerts.fire({
        severity: 'critical',
        key: `sweep.silent:${sweep.name}`,
        title: `Background job '${sweep.name}' has stopped running`,
        // The consequence, not the symptom: whoever reads this at 3am needs
        // to know what is broken for customers, not what a queue looks like.
        body:
          `It last completed ${
            everRan ? `${Math.round(silentMs / 60_000)} minute(s) ago` : 'never since this instance started'
          }, and its tolerance is ${Math.round(sweep.maxSilenceMs / 60_000)} minute(s). ` +
          `What this job exists to do: ${sweep.why}`,
        context: {
          job: sweep.name,
          silentMinutes: Math.round(silentMs / 60_000),
          toleranceMinutes: Math.round(sweep.maxSilenceMs / 60_000),
          everRan: String(everRan),
        },
      });
    }
  }
}
