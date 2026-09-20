import {
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  MetricsSnapshot,
} from '../../src/modules/observability/alert-rules';

const quiet: MetricsSnapshot = {
  ledgerImbalance: [{ currency: 'AMD', difference: 0n }],
  withdrawalsStuck: 0,
  withdrawalsUncertain: 0,
  compensationRequired: 0,
  reconciliationMismatchesOpen: 0,
  integrations: {
    'yandex-fleet': { mode: 'live', status: 'OK', lastOkAgeSeconds: 10 },
    idram: { mode: 'live', status: 'OK', lastOkAgeSeconds: 10 },
    sms: { mode: 'live', status: 'OK', lastOkAgeSeconds: 10 },
    push: { mode: 'mock', status: 'UNKNOWN', lastOkAgeSeconds: null },
    redis: { mode: 'live', status: 'OK', lastOkAgeSeconds: 5 },
  },
  redisAvailable: true,
  autoPayoutPaused: 0,
  autoPayoutFailedLastHour: 0,
  otpChallengesLast15m: 0,
  otpFailedLast15m: 0,
  pinFailedLast15m: 0,
  pinLockedDrivers: 0,
  workerLagSeconds: 0,
  notificationBacklog: 0,
  notificationOldestSeconds: 0,
};

const names = (s: MetricsSnapshot) => evaluateAlerts(s).map((a) => `${a.name}:${a.severity}`);

describe('alert rules', () => {
  it('a quiet system raises nothing', () => {
    expect(evaluateAlerts(quiet)).toEqual([]);
  });

  it('a ledger that does not balance is CRITICAL, whatever else is true', () => {
    const alerts = evaluateAlerts({
      ...quiet,
      ledgerImbalance: [{ currency: 'AMD', difference: -100n }],
    });
    expect(alerts).toEqual([
      expect.objectContaining({ name: 'ledger_imbalance', severity: 'CRITICAL', value: 1 }),
    ]);
    expect(alerts[0]!.message).toContain('AMD -100');
  });

  it('stuck money is CRITICAL; uncertain, compensation and mismatches are warnings', () => {
    expect(
      names({
        ...quiet,
        withdrawalsStuck: 2,
        withdrawalsUncertain: 1,
        compensationRequired: 1,
        reconciliationMismatchesOpen: 3,
      }),
    ).toEqual([
      'withdrawal_stuck:CRITICAL',
      'withdrawal_uncertain:WARNING',
      'compensation_required:WARNING',
      'reconciliation_mismatch:WARNING',
    ]);
  });

  it('an integration is unavailable when DOWN or stale — but never when it is a mock', () => {
    const stale = {
      mode: 'live' as const,
      status: 'OK' as const,
      lastOkAgeSeconds: DEFAULT_THRESHOLDS.integrationStaleSeconds + 1,
    };
    expect(
      names({
        ...quiet,
        integrations: {
          ...quiet.integrations,
          'yandex-fleet': { mode: 'live', status: 'DOWN', lastOkAgeSeconds: 900 },
          idram: stale,
          sms: { mode: 'mock', status: 'DOWN', lastOkAgeSeconds: null },
          push: { mode: 'live', status: 'DOWN', lastOkAgeSeconds: 900 },
        },
      }),
    ).toEqual([
      'yandex_unavailable:CRITICAL',
      'idram_unavailable:CRITICAL',
      'push_unavailable:WARNING',
    ]);
  });

  it('Redis down is CRITICAL; a memory limiter (null) is not an alert', () => {
    expect(names({ ...quiet, redisAvailable: false })).toEqual(['redis_unavailable:CRITICAL']);
    expect(names({ ...quiet, redisAvailable: null })).toEqual([]);
  });

  it('automatic payout failures and paused rules warn', () => {
    expect(names({ ...quiet, autoPayoutPaused: 1 })).toEqual(['auto_payout_failed:WARNING']);
    expect(names({ ...quiet, autoPayoutFailedLastHour: 2 })).toEqual([
      'auto_payout_failed:WARNING',
    ]);
  });

  it('OTP failure rate needs a minimum sample, then a rate', () => {
    expect(names({ ...quiet, otpChallengesLast15m: 5, otpFailedLast15m: 5 })).toEqual([]);
    expect(names({ ...quiet, otpChallengesLast15m: 20, otpFailedLast15m: 9 })).toEqual([]);
    const alerts = evaluateAlerts({ ...quiet, otpChallengesLast15m: 20, otpFailedLast15m: 10 });
    expect(alerts).toEqual([
      expect.objectContaining({ name: 'otp_failure_rate_high', value: 500_000 }),
    ]);
  });

  it('PIN: many failures or several locked drivers', () => {
    expect(names({ ...quiet, pinFailedLast15m: 19, pinLockedDrivers: 2 })).toEqual([]);
    expect(names({ ...quiet, pinFailedLast15m: 20 })).toEqual(['pin_failure_rate_high:WARNING']);
    expect(names({ ...quiet, pinLockedDrivers: 3 })).toEqual(['pin_failure_rate_high:WARNING']);
  });

  it('worker lag escalates from warning to critical', () => {
    expect(names({ ...quiet, workerLagSeconds: 119 })).toEqual([]);
    expect(names({ ...quiet, workerLagSeconds: 120 })).toEqual(['worker_lag:WARNING']);
    expect(names({ ...quiet, workerLagSeconds: 600 })).toEqual(['worker_lag:CRITICAL']);
  });

  it('notification backlog by count or by age', () => {
    expect(names({ ...quiet, notificationBacklog: 99, notificationOldestSeconds: 599 })).toEqual(
      [],
    );
    expect(names({ ...quiet, notificationBacklog: 100 })).toEqual(['notification_backlog:WARNING']);
    expect(names({ ...quiet, notificationBacklog: 1, notificationOldestSeconds: 600 })).toEqual([
      'notification_backlog:WARNING',
    ]);
  });
});
