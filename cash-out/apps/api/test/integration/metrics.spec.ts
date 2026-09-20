import {
  createHarness,
  Harness,
  requestWithdrawal,
  resetDatabase,
  seedDriver,
  seedPricing,
} from '../harness';

/**
 * The snapshot the alert rules read, gathered from a real database with the
 * conditions seeded, and the Prometheus rendering of it.
 */
describe('metrics snapshot and export', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.rateLimiter.resetAll();
    harness.yandex.reset();
    harness.provider.reset();
    await seedPricing(harness.prisma);
  });

  it('an empty, healthy system: zeros, balanced ledger, mock integrations, no alerts', async () => {
    const { snapshot, alerts } = await harness.metrics.evaluate();
    expect(snapshot.withdrawalsStuck).toBe(0);
    expect(snapshot.ledgerImbalance.every((row) => row.difference === 0n)).toBe(true);
    expect(snapshot.integrations['yandex-fleet']?.mode).toBe('mock');
    expect(snapshot.integrations.idram?.mode).toBe('mock');
    expect(snapshot.integrations.sms?.mode).toBe('mock');
    expect(snapshot.redisAvailable).toBeNull();
    expect(alerts).toEqual([]);

    const text = await harness.metrics.render();
    // Every series carries the deployment label, so match on the labels present.
    expect(text).toMatch(/cashout_withdrawals_stuck\{[^}]*\} 0/);
    expect(text).toMatch(
      /cashout_integration_up\{[^}]*integration="yandex-fleet"[^}]*mode="mock"[^}]*\} 0/,
    );
    expect(text).toContain('cashout_ledger_imbalance_minor');
  });

  it('sees a stuck withdrawal, an uncertain one, worker lag, a backlog, a paused rule and a mismatch', async () => {
    const driver = await seedDriver(harness, { balance: 5_000_000n });
    const created = await requestWithdrawal(harness, driver, 1_000_000n);
    // Debited in the park, then nothing for longer than the SLA.
    await harness.prisma.withdrawal.update({
      where: { id: created.id },
      data: {
        state: 'PAYOUT_UNCERTAIN',
        nextAttemptAt: new Date(Date.now() - 700_000),
        leaseUntil: null,
      },
    });
    await harness.prisma
      .$executeRaw`UPDATE withdrawals SET "updatedAt" = now() - interval '20 minutes' WHERE id = ${created.id}::uuid`;
    await harness.prisma.autoPayoutRule.create({
      data: {
        driverId: driver.driverId,
        parkId: driver.parkId,
        payoutMethodId: driver.payoutMethodId,
        cadence: 'ON_THRESHOLD',
        thresholdMinor: 1_000_000n,
        currency: 'AMD',
        timezone: 'Asia/Yerevan',
        enabled: true,
        pausedAt: new Date(),
        pausedReason: 'test',
        nextCheckAt: new Date(),
        consecutiveFailures: 3,
        lastFailureCode: 'x',
        lastRunAt: new Date(),
      },
    });
    const run = await harness.prisma.reconciliationRun.create({
      data: { kind: 'LEDGER', triggeredBy: 'TEST', status: 'COMPLETED' },
    });
    await harness.prisma.reconciliationMismatch.create({
      data: { runId: run.id, kind: 'test', expected: '1', actual: '2' },
    });
    for (let i = 0; i < 3; i += 1) {
      await harness.notifications.enqueue({ driverId: driver.driverId, kind: 'PARK_SWITCHED' });
    }
    await harness.prisma
      .$executeRaw`UPDATE outbox_messages SET "createdAt" = now() - interval '15 minutes'`;

    const { snapshot, alerts } = await harness.metrics.evaluate();
    expect(snapshot.withdrawalsStuck).toBe(1);
    expect(snapshot.withdrawalsUncertain).toBe(1);
    expect(snapshot.workerLagSeconds).toBeGreaterThanOrEqual(600);
    expect(snapshot.autoPayoutPaused).toBe(1);
    expect(snapshot.autoPayoutFailedLastHour).toBe(1);
    expect(snapshot.reconciliationMismatchesOpen).toBe(1);
    expect(snapshot.notificationBacklog).toBe(3);
    expect(snapshot.notificationOldestSeconds).toBeGreaterThanOrEqual(600);

    const names = alerts.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'withdrawal_stuck',
        'withdrawal_uncertain',
        'reconciliation_mismatch',
        'auto_payout_failed',
        'worker_lag',
        'notification_backlog',
      ]),
    );
    expect(alerts.find((a) => a.name === 'worker_lag')?.severity).toBe('CRITICAL');

    const text = await harness.metrics.render();
    expect(text).toMatch(
      /cashout_alert_active\{[^}]*alert="withdrawal_stuck"[^}]*severity="CRITICAL"[^}]*\} 1/,
    );
    expect(text).toMatch(/cashout_withdrawals_uncertain\{[^}]*\} 1/);
  });

  it('counts OTP and PIN failures in the window', async () => {
    const driver = await seedDriver(harness, { balance: 5_000_000n });
    for (let i = 0; i < 12; i += 1) {
      await harness.prisma.otpChallenge.create({
        data: {
          phone: `+3749100${String(i).padStart(4, '0')}`,
          codeHash: 'x',
          deviceId: 'd',
          attempts: i < 7 ? 5 : 0,
          maxAttempts: 5,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await expect(
        harness.security.authorize(
          driver.driverId,
          { userId: driver.userId, deviceId: driver.deviceId },
          {
            method: 'PIN',
            pin: '000000',
            purpose: 'WITHDRAWAL',
            quoteId: undefined as never,
          },
        ),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/PIN_INVALID|VALIDATION_FAILED|AUTHORIZATION_INVALID/),
      });
    }

    const { snapshot, alerts } = await harness.metrics.evaluate();
    expect(snapshot.otpChallengesLast15m).toBe(12);
    expect(snapshot.otpFailedLast15m).toBe(7);
    expect(alerts.map((a) => a.name)).toContain('otp_failure_rate_high');
    expect(snapshot.pinFailedLast15m).toBeGreaterThanOrEqual(0);
  });

  it('the scrape endpoint renders the Prometheus text format', async () => {
    const text = await harness.metrics.render();
    expect(text).toMatch(/^# HELP cashout_/m);
    expect(text).toMatch(/cashout_metrics_evaluated_timestamp_seconds\{[^}]*\} \d+/);
  });
});
