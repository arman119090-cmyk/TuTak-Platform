export type AlertSeverity = 'CRITICAL' | 'WARNING';

export interface ActiveAlert {
  readonly name: AlertName;
  readonly severity: AlertSeverity;
  readonly value: number;
  readonly message: string;
}

export type AlertName =
  | 'ledger_imbalance'
  | 'withdrawal_stuck'
  | 'withdrawal_uncertain'
  | 'compensation_required'
  | 'reconciliation_mismatch'
  | 'yandex_unavailable'
  | 'idram_unavailable'
  | 'sms_unavailable'
  | 'redis_unavailable'
  | 'push_unavailable'
  | 'auto_payout_failed'
  | 'otp_failure_rate_high'
  | 'pin_failure_rate_high'
  | 'worker_lag'
  | 'notification_backlog';

export interface IntegrationState {
  readonly mode: 'mock' | 'live';
  readonly status: 'OK' | 'DOWN' | 'UNKNOWN';
  readonly lastOkAgeSeconds: number | null;
}

/** Everything the rules look at, gathered once per evaluation. */
export interface MetricsSnapshot {
  readonly ledgerImbalance: Array<{ currency: string; difference: bigint }>;
  readonly withdrawalsStuck: number;
  readonly withdrawalsUncertain: number;
  readonly compensationRequired: number;
  readonly reconciliationMismatchesOpen: number;
  readonly integrations: Record<string, IntegrationState>;
  readonly redisAvailable: boolean | null;
  readonly autoPayoutPaused: number;
  readonly autoPayoutFailedLastHour: number;
  readonly otpChallengesLast15m: number;
  readonly otpFailedLast15m: number;
  readonly pinFailedLast15m: number;
  readonly pinLockedDrivers: number;
  readonly workerLagSeconds: number;
  readonly notificationBacklog: number;
  readonly notificationOldestSeconds: number;
}

export interface AlertThresholds {
  readonly integrationStaleSeconds: number;
  readonly otpMinSample: number;
  readonly otpFailureRatePpm: number;
  readonly pinFailuresPer15m: number;
  readonly pinLockedDrivers: number;
  readonly workerLagWarnSeconds: number;
  readonly workerLagCriticalSeconds: number;
  readonly notificationBacklog: number;
  readonly notificationOldestSeconds: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  integrationStaleSeconds: 300,
  otpMinSample: 10,
  otpFailureRatePpm: 500_000,
  pinFailuresPer15m: 20,
  pinLockedDrivers: 3,
  workerLagWarnSeconds: 120,
  workerLagCriticalSeconds: 600,
  notificationBacklog: 100,
  notificationOldestSeconds: 600,
};

/**
 * The alert rules, as a pure function of a snapshot, so they are testable
 * without a database and readable without Prometheus. The same conditions
 * are expressed for Prometheus in ops/prometheus-alerts.yml against the
 * gauges the metrics endpoint exports; this evaluation is what the admin
 * page and the process log show.
 *
 * A ledger that does not balance is the one alert that is never a warning.
 */
export function evaluateAlerts(
  s: MetricsSnapshot,
  t: AlertThresholds = DEFAULT_THRESHOLDS,
): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];
  const add = (name: AlertName, severity: AlertSeverity, value: number, message: string) =>
    alerts.push({ name, severity, value, message });

  const unbalanced = s.ledgerImbalance.filter((row) => row.difference !== 0n);
  if (unbalanced.length > 0) {
    add(
      'ledger_imbalance',
      'CRITICAL',
      unbalanced.length,
      `Ledger does not balance: ${unbalanced.map((r) => `${r.currency} ${r.difference}`).join(', ')}. Stop payouts and investigate.`,
    );
  }
  if (s.withdrawalsStuck > 0) {
    add(
      'withdrawal_stuck',
      'CRITICAL',
      s.withdrawalsStuck,
      `${s.withdrawalsStuck} withdrawal(s) debited the driver and stopped moving past the SLA.`,
    );
  }
  if (s.withdrawalsUncertain > 0) {
    add(
      'withdrawal_uncertain',
      'WARNING',
      s.withdrawalsUncertain,
      `${s.withdrawalsUncertain} withdrawal(s) in an uncertain state awaiting a probe.`,
    );
  }
  if (s.compensationRequired > 0) {
    add(
      'compensation_required',
      'WARNING',
      s.compensationRequired,
      `${s.compensationRequired} withdrawal(s) need the park debit reversed.`,
    );
  }
  if (s.reconciliationMismatchesOpen > 0) {
    add(
      'reconciliation_mismatch',
      'WARNING',
      s.reconciliationMismatchesOpen,
      `${s.reconciliationMismatchesOpen} open reconciliation mismatch(es).`,
    );
  }

  const down = (name: string): boolean => {
    const state = s.integrations[name];
    if (!state || state.mode !== 'live') return false;
    if (state.status === 'DOWN') return true;
    return state.lastOkAgeSeconds !== null && state.lastOkAgeSeconds > t.integrationStaleSeconds;
  };
  if (down('yandex-fleet'))
    add(
      'yandex_unavailable',
      'CRITICAL',
      1,
      'Yandex Fleet API is not answering: balances and debits are blocked.',
    );
  if (down('idram'))
    add(
      'idram_unavailable',
      'CRITICAL',
      1,
      'iDram is not answering: payouts cannot be submitted or probed.',
    );
  if (down('sms'))
    add('sms_unavailable', 'CRITICAL', 1, 'SMS gateway is not answering: nobody can sign in.');
  if (s.redisAvailable === false)
    add(
      'redis_unavailable',
      'CRITICAL',
      1,
      'Redis is unreachable: OTP, PIN and admin sign-in are being refused (deny policy) or unlimited (allow policy).',
    );
  if (down('push'))
    add(
      'push_unavailable',
      'WARNING',
      1,
      'Push provider is not answering; notifications are queuing.',
    );

  if (s.autoPayoutFailedLastHour > 0 || s.autoPayoutPaused > 0) {
    add(
      'auto_payout_failed',
      'WARNING',
      s.autoPayoutFailedLastHour + s.autoPayoutPaused,
      `${s.autoPayoutFailedLastHour} automatic payout failure(s) in the last hour; ${s.autoPayoutPaused} rule(s) paused.`,
    );
  }
  if (s.otpChallengesLast15m >= t.otpMinSample) {
    const ppm = Math.round((s.otpFailedLast15m / s.otpChallengesLast15m) * 1_000_000);
    if (ppm >= t.otpFailureRatePpm) {
      add(
        'otp_failure_rate_high',
        'WARNING',
        ppm,
        `${s.otpFailedLast15m} of ${s.otpChallengesLast15m} OTP challenges in 15 min were exhausted or undelivered: SMS trouble or an attack.`,
      );
    }
  }
  if (s.pinFailedLast15m >= t.pinFailuresPer15m || s.pinLockedDrivers >= t.pinLockedDrivers) {
    add(
      'pin_failure_rate_high',
      'WARNING',
      s.pinFailedLast15m,
      `${s.pinFailedLast15m} wrong PINs in 15 min, ${s.pinLockedDrivers} driver(s) locked.`,
    );
  }
  if (s.workerLagSeconds >= t.workerLagCriticalSeconds) {
    add(
      'worker_lag',
      'CRITICAL',
      s.workerLagSeconds,
      `The oldest due withdrawal has waited ${s.workerLagSeconds}s for a worker.`,
    );
  } else if (s.workerLagSeconds >= t.workerLagWarnSeconds) {
    add(
      'worker_lag',
      'WARNING',
      s.workerLagSeconds,
      `The oldest due withdrawal has waited ${s.workerLagSeconds}s for a worker.`,
    );
  }
  if (
    s.notificationBacklog >= t.notificationBacklog ||
    s.notificationOldestSeconds >= t.notificationOldestSeconds
  ) {
    add(
      'notification_backlog',
      'WARNING',
      s.notificationBacklog,
      `${s.notificationBacklog} notification(s) queued, oldest ${s.notificationOldestSeconds}s.`,
    );
  }

  return alerts;
}
