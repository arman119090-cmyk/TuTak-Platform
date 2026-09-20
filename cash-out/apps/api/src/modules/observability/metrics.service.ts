import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import { hasOutstandingDebit } from '@cashout/contracts';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { RateLimiter } from '../../common/rate-limit.service';
import { RedisRateLimiter } from '../../common/rate-limit/redis-rate-limiter';
import { ENV, Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsGatewayPort } from '../auth/sms-gateway.port';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationPort } from '../notifications/notification.port';
import {
  ActiveAlert,
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  IntegrationState,
  MetricsSnapshot,
} from './alert-rules';

const UNCERTAIN = ['RESERVE_UNCERTAIN', 'PAYOUT_UNCERTAIN'] as const;
const NEEDS_COMPENSATION = ['COMPENSATING', 'PAYOUT_FAILED', 'PAYOUT_RETURNED'] as const;
const TERMINAL = ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] as const;

/**
 * Gathers the snapshot, exports it as Prometheus gauges, evaluates the alert
 * rules and logs transitions. Runs once a minute; `evaluate()` is also called
 * directly by tests and by the admin page.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly gauges: Record<string, Gauge<string>>;
  private lastAlerts: ActiveAlert[] = [];
  private lastEvaluatedAt: Date | null = null;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly limiter: RateLimiter,
    private readonly sms: SmsGatewayPort,
    private readonly push: NotificationPort,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {
    this.registry.setDefaultLabels({ deployment: env.DEPLOYMENT_ENV });
    collectDefaultMetrics({ register: this.registry, prefix: 'cashout_process_' });
    const gauge = (name: string, help: string, labelNames: string[] = []) =>
      new Gauge({ name, help, labelNames, registers: [this.registry] });
    this.gauges = {
      ledgerImbalance: gauge(
        'cashout_ledger_imbalance_minor',
        'Debits minus credits per currency; anything but 0 is an incident',
        ['currency'],
      ),
      stuck: gauge(
        'cashout_withdrawals_stuck',
        'Withdrawals that debited the driver and stopped past the SLA',
      ),
      uncertain: gauge(
        'cashout_withdrawals_uncertain',
        'Withdrawals in RESERVE_UNCERTAIN or PAYOUT_UNCERTAIN',
      ),
      compensation: gauge(
        'cashout_withdrawals_compensation_required',
        'Withdrawals whose park debit must be reversed',
      ),
      inFlight: gauge('cashout_withdrawals_in_flight', 'Withdrawals not yet in a terminal state'),
      mismatches: gauge(
        'cashout_reconciliation_mismatches_open',
        'Unresolved reconciliation mismatches',
      ),
      integrationUp: gauge(
        'cashout_integration_up',
        '1 when the integration answered its last probe',
        ['integration', 'mode'],
      ),
      integrationLastOkAge: gauge(
        'cashout_integration_last_ok_age_seconds',
        'Seconds since the integration last answered',
        ['integration'],
      ),
      redisUp: gauge(
        'cashout_redis_up',
        '1 when the rate-limit Redis is reachable (only under RATE_LIMIT_BACKEND=redis)',
      ),
      autoPaused: gauge(
        'cashout_auto_payout_rules_paused',
        'Automatic payout rules paused after failures',
      ),
      autoFailed: gauge(
        'cashout_auto_payout_failures_1h',
        'Automatic payout evaluations that failed in the last hour',
      ),
      otpTotal: gauge(
        'cashout_otp_challenges_15m',
        'OTP challenges created in the last 15 minutes',
      ),
      otpFailed: gauge(
        'cashout_otp_challenges_failed_15m',
        'OTP challenges exhausted or undelivered in the last 15 minutes',
      ),
      pinFailed: gauge('cashout_pin_failures_15m', 'Wrong PIN attempts in the last 15 minutes'),
      pinLocked: gauge('cashout_pin_locked_drivers', 'Drivers currently locked out of their PIN'),
      workerLag: gauge(
        'cashout_worker_lag_seconds',
        'Age of the oldest withdrawal due for a worker and not leased',
      ),
      backlog: gauge('cashout_notification_backlog', 'Notifications queued and not yet delivered'),
      backlogOldest: gauge(
        'cashout_notification_oldest_seconds',
        'Age of the oldest undelivered notification',
      ),
      alert: gauge('cashout_alert_active', '1 while the alert condition holds', [
        'alert',
        'severity',
      ]),
      evaluatedAt: gauge(
        'cashout_metrics_evaluated_timestamp_seconds',
        'When the snapshot was last taken',
      ),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.evaluate();
    } catch (error) {
      this.logger.fail('Metrics evaluation failed', error);
    } finally {
      this.running = false;
    }
  }

  get alerts(): { evaluatedAt: string | null; alerts: ActiveAlert[] } {
    return { evaluatedAt: this.lastEvaluatedAt?.toISOString() ?? null, alerts: this.lastAlerts };
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  async evaluate(): Promise<{ snapshot: MetricsSnapshot; alerts: ActiveAlert[] }> {
    const snapshot = await this.snapshot();
    const alerts = evaluateAlerts(snapshot, DEFAULT_THRESHOLDS);
    this.export(snapshot, alerts);
    this.logTransitions(alerts);
    this.lastAlerts = alerts;
    this.lastEvaluatedAt = this.clock.now();
    return { snapshot, alerts };
  }

  // ---------------------------------------------------------------- snapshot

  async snapshot(): Promise<MetricsSnapshot> {
    const now = this.clock.now();
    const nowMs = now.getTime();
    const ago = (seconds: number) => new Date(nowMs - seconds * 1000);
    const sla = this.env.WITHDRAWAL_SLA_SECONDS;

    const [
      ledgerImbalance,
      openNotTerminal,
      uncertain,
      compensation,
      mismatches,
      healthRows,
      autoPaused,
      autoFailed,
      otpTotal,
      otpExhausted,
      otpUndelivered,
      pinFailed,
      pinLocked,
      dueOldest,
      backlog,
      backlogOldest,
    ] = await Promise.all([
      this.ledger.trialBalance(),
      this.prisma.withdrawal.findMany({
        where: { state: { notIn: [...TERMINAL] }, updatedAt: { lt: ago(sla) } },
        select: { state: true },
        take: 1000,
      }),
      this.prisma.withdrawal.count({ where: { state: { in: [...UNCERTAIN] } } }),
      this.prisma.withdrawal.count({ where: { state: { in: [...NEEDS_COMPENSATION] } } }),
      this.prisma.reconciliationMismatch.count({ where: { resolvedAt: null } }),
      this.prisma.integrationHealth.findMany(),
      this.prisma.autoPayoutRule.count({ where: { enabled: true, pausedAt: { not: null } } }),
      this.prisma.autoPayoutRule.count({
        where: { lastFailureCode: { not: null }, lastRunAt: { gte: ago(3600) } },
      }),
      this.prisma.otpChallenge.count({ where: { createdAt: { gte: ago(900) } } }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM otp_challenges
        WHERE "createdAt" >= ${ago(900)} AND "consumedAt" IS NULL AND attempts >= "maxAttempts"`,
      this.prisma.otpChallenge.count({
        where: { createdAt: { gte: ago(900) }, deliveryFailed: true },
      }),
      this.prisma.auditLog.count({
        where: { action: 'security.pin_failed', at: { gte: ago(900) } },
      }),
      this.prisma.driverSecurity.count({ where: { pinLockedUntil: { gt: now } } }),
      this.prisma.withdrawal.findFirst({
        where: {
          state: { notIn: [...TERMINAL] },
          nextAttemptAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        orderBy: { nextAttemptAt: 'asc' },
        select: { nextAttemptAt: true },
      }),
      this.prisma.outboxMessage.count({ where: { processedAt: null } }),
      this.prisma.outboxMessage.findFirst({
        where: { processedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const integrations: Record<string, IntegrationState> = {};
    const mode = (name: string): 'mock' | 'live' => {
      switch (name) {
        case 'yandex-fleet':
          return this.env.YANDEX_MODE;
        case 'idram':
          return this.env.PROVIDER_MODE;
        case 'sms':
          return this.sms.mode;
        case 'push':
          return this.push.mode;
        case 'redis':
          return this.env.RATE_LIMIT_BACKEND === 'redis' ? 'live' : 'mock';
        default:
          return 'live';
      }
    };
    const byName = new Map(healthRows.map((row) => [row.integration, row]));
    const logical: Array<[string, string]> = [
      ['yandex-fleet', 'yandex-fleet'],
      ['idram', 'idram'],
      ['sms', this.sms.name],
      ['push', this.push.name],
      ['redis', 'redis'],
    ];
    for (const [name, rowName] of logical) {
      const row = byName.get(rowName);
      integrations[name] = {
        mode: mode(name),
        status: row?.status === 'OK' ? 'OK' : row?.status === 'DOWN' ? 'DOWN' : 'UNKNOWN',
        lastOkAgeSeconds: row?.lastOkAt
          ? Math.round((nowMs - row.lastOkAt.getTime()) / 1000)
          : null,
      };
    }

    return {
      ledgerImbalance,
      withdrawalsStuck: openNotTerminal.filter((row) => hasOutstandingDebit(row.state)).length,
      withdrawalsUncertain: uncertain,
      compensationRequired: compensation,
      reconciliationMismatchesOpen: mismatches,
      integrations,
      redisAvailable: this.limiter instanceof RedisRateLimiter ? this.limiter.available : null,
      autoPayoutPaused: autoPaused,
      autoPayoutFailedLastHour: autoFailed,
      otpChallengesLast15m: otpTotal,
      otpFailedLast15m: Number(otpExhausted[0]?.n ?? 0n) + otpUndelivered,
      pinFailedLast15m: pinFailed,
      pinLockedDrivers: pinLocked,
      workerLagSeconds: dueOldest?.nextAttemptAt
        ? Math.max(0, Math.round((nowMs - dueOldest.nextAttemptAt.getTime()) / 1000))
        : 0,
      notificationBacklog: backlog,
      notificationOldestSeconds: backlogOldest
        ? Math.max(0, Math.round((nowMs - backlogOldest.createdAt.getTime()) / 1000))
        : 0,
    };
  }

  // ------------------------------------------------------------------ export

  private export(s: MetricsSnapshot, alerts: ActiveAlert[]): void {
    const g = this.gauges;
    g.ledgerImbalance!.reset();
    for (const row of s.ledgerImbalance)
      g.ledgerImbalance!.set({ currency: row.currency }, Number(row.difference));
    g.stuck!.set(s.withdrawalsStuck);
    g.uncertain!.set(s.withdrawalsUncertain);
    g.compensation!.set(s.compensationRequired);
    g.mismatches!.set(s.reconciliationMismatchesOpen);
    g.integrationUp!.reset();
    g.integrationLastOkAge!.reset();
    for (const [name, state] of Object.entries(s.integrations)) {
      g.integrationUp!.set({ integration: name, mode: state.mode }, state.status === 'OK' ? 1 : 0);
      if (state.lastOkAgeSeconds !== null)
        g.integrationLastOkAge!.set({ integration: name }, state.lastOkAgeSeconds);
    }
    if (s.redisAvailable !== null) g.redisUp!.set(s.redisAvailable ? 1 : 0);
    g.autoPaused!.set(s.autoPayoutPaused);
    g.autoFailed!.set(s.autoPayoutFailedLastHour);
    g.otpTotal!.set(s.otpChallengesLast15m);
    g.otpFailed!.set(s.otpFailedLast15m);
    g.pinFailed!.set(s.pinFailedLast15m);
    g.pinLocked!.set(s.pinLockedDrivers);
    g.workerLag!.set(s.workerLagSeconds);
    g.backlog!.set(s.notificationBacklog);
    g.backlogOldest!.set(s.notificationOldestSeconds);
    g.alert!.reset();
    for (const alert of alerts) g.alert!.set({ alert: alert.name, severity: alert.severity }, 1);
    g.evaluatedAt!.set(Math.floor(this.clock.nowMs() / 1000));
  }

  private logTransitions(alerts: ActiveAlert[]): void {
    const before = new Set(this.lastAlerts.map((a) => a.name));
    const after = new Set(alerts.map((a) => a.name));
    for (const alert of alerts) {
      if (before.has(alert.name)) continue;
      const payload = { alert: alert.name, severity: alert.severity, value: alert.value };
      if (alert.severity === 'CRITICAL')
        this.logger.error(
          `ALERT ${alert.name}: ${alert.message}`,
          undefined,
          JSON.stringify(payload),
        );
      else this.logger.warning(`ALERT ${alert.name}: ${alert.message}`, payload);
    }
    for (const name of before) {
      if (!after.has(name)) this.logger.info(`ALERT resolved: ${name}`, { alert: name });
    }
  }
}
