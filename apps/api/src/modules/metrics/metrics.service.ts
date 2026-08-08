import { Injectable, Logger } from '@nestjs/common';
import { LedgerAccountType, PayoutStatus, ReconciliationStatus } from '@prisma/client';
import { Registry, Gauge, collectDefaultMetrics } from 'prom-client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SWEEPS } from '../sweeps/sweeps.jobs';

/**
 * The numbers that say whether the *business* is working.
 *
 * Tracing and logs answer "why is this request slow" and "what happened to
 * that payment". Neither answers "is money still arriving", "does the ledger
 * still balance", or "is anything stuck" — which is what someone actually
 * wants on a wall a month after launch.
 *
 * Everything here is derived from the database at scrape time rather than
 * counted in the process. In-process counters reset on every deploy and are
 * per-replica, so two instances would each report half the truth and a
 * restart would report none of it. The queries are aggregates over indexed
 * columns, and a scrape runs once every fifteen or thirty seconds; if that
 * ever stops being cheap, the fix is a materialized summary table, not a
 * counter that lies.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  constructor(private readonly prisma: PrismaService) {
    this.registry.setDefaultLabels({ service: 'tutak-api' });
    // Event loop lag, heap, GC. Cheap, and the first thing anyone asks for
    // when the API feels slow.
    collectDefaultMetrics({ register: this.registry });
    this.defineGauges();
  }

  /**
   * The single most important number on this platform.
   *
   * Every account balance summed must be exactly zero. A non-zero value
   * means the double-entry invariant has been violated and some money is
   * either invented or lost. It is a gauge rather than an alert because an
   * operator should be able to see it was zero all month, not merely that
   * nobody has been paged.
   */
  private ledgerImbalance!: Gauge;
  private accountBalance!: Gauge<'account'>;
  private outboxPending!: Gauge;
  private outboxDeadLettered!: Gauge;
  private payoutsPending!: Gauge;
  private payoutsPendingAmount!: Gauge;
  private paymentsLastHour!: Gauge<'status'>;
  private paymentVolumeLastHour!: Gauge;
  private bonusAccruedLastHour!: Gauge;
  private walletsTotal!: Gauge;
  private reconciliationDrift!: Gauge;
  private reconciliationAgeSeconds!: Gauge;
  private sweepAgeSeconds!: Gauge<'job'>;

  private defineGauges(): void {
    const g = (name: string, help: string, labelNames: string[] = []) =>
      new Gauge({ name, help, labelNames, registers: [this.registry] });

    this.ledgerImbalance = g(
      'tutak_ledger_imbalance_amd',
      'Sum of every ledger account balance. Must be exactly 0; anything else means money was invented or lost.',
    );
    this.accountBalance = g(
      'tutak_ledger_account_balance_amd',
      'Balance per chart-of-accounts type. Credit-normal accounts are negative by convention.',
      ['account'],
    );
    this.outboxPending = g(
      'tutak_outbox_pending',
      'Outbox events not yet processed. A number that climbs and does not come back down means settlement has stalled.',
    );
    this.outboxDeadLettered = g(
      'tutak_outbox_dead_lettered',
      'Outbox events that exhausted their retries. Should be 0; each one is work the platform promised itself and stopped attempting.',
    );
    this.payoutsPending = g(
      'tutak_payouts_pending',
      'Payouts requested but not yet confirmed by the bank.',
    );
    this.payoutsPendingAmount = g(
      'tutak_payouts_pending_amd',
      'Money sitting in clearing: requested, not yet confirmed.',
    );
    this.paymentsLastHour = g(
      'tutak_payments_last_hour',
      'Payments in the last hour by status. The pulse of the business.',
      ['status'],
    );
    this.paymentVolumeLastHour = g(
      'tutak_payment_volume_last_hour_amd',
      'Captured payment value in the last hour.',
    );
    this.bonusAccruedLastHour = g(
      'tutak_bonus_accrued_last_hour',
      'Loyalty points issued in the last hour.',
    );
    this.walletsTotal = g('tutak_wallets_total', 'Customer wallets in existence.');
    this.reconciliationDrift = g(
      'tutak_reconciliation_drift_findings',
      'Discrepancies found by the most recent reconciliation run. Should be 0.',
    );
    this.reconciliationAgeSeconds = g(
      'tutak_reconciliation_age_seconds',
      'Seconds since the last reconciliation run. A number that keeps growing means the sweep has stopped.',
    );
    // Per job rather than one aggregate: "some sweep is late" is not
    // actionable, and the tolerances differ by two orders of magnitude
    // between the outbox drain and the nightly reconciliation. -1 means the
    // job has never completed, which a dashboard must not draw as "0 seconds
    // ago".
    this.sweepAgeSeconds = g(
      'tutak_sweep_seconds_since_success',
      'Seconds since each recurring job last completed. -1 means it has never completed. Compare against the job tolerance in sweeps.jobs.ts.',
      ['job'],
    );
  }

  /**
   * Fills every gauge, then renders the exposition format.
   *
   * A failure here returns whatever was already collected rather than a 500:
   * a metrics endpoint that goes down during an incident removes the
   * instrument at the exact moment it is needed, and the default Node
   * metrics are still worth serving.
   */
  async scrape(): Promise<string> {
    try {
      await this.refresh();
    } catch (err) {
      this.logger.error(
        `Metric collection failed, serving what is available: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return this.registry.metrics();
  }

  private async refresh(): Promise<void> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [accounts, outbox, deadLettered, payouts, payments, bonus, wallets, lastRun, sweeps] =
      await Promise.all([
        this.prisma.ledgerAccount.groupBy({ by: ['type'], _sum: { balance: true } }),
        this.prisma.outboxEvent.count({ where: { processedAt: null } }),
        this.prisma.outboxEvent.count({ where: { processedAt: null, attempts: { gte: 10 } } }),
        this.prisma.payout.aggregate({
          where: { status: PayoutStatus.REQUESTED },
          _count: true,
          _sum: { amount: true },
        }),
        this.prisma.payment.groupBy({
          by: ['status'],
          where: { createdAt: { gte: hourAgo } },
          _count: true,
          _sum: { amount: true },
        }),
        this.prisma.bonusLot.aggregate({
          where: { createdAt: { gte: hourAgo } },
          _sum: { originalAmount: true },
        }),
        this.prisma.wallet.count(),
        this.prisma.reconciliationRun.findFirst({ orderBy: { createdAt: 'desc' } }),
        this.prisma.sweepRun.findMany(),
      ]);

    let total = 0;
    // Reset first: an account type that stops existing must stop being
    // reported, not freeze at its last value and look like a live balance.
    this.accountBalance.reset();
    for (const row of accounts) {
      const value = Number(row._sum.balance ?? 0);
      total += value;
      this.accountBalance.set({ account: row.type }, value);
    }
    for (const type of Object.values(LedgerAccountType)) {
      if (!accounts.some((a) => a.type === type)) this.accountBalance.set({ account: type }, 0);
    }
    this.ledgerImbalance.set(total);

    this.outboxPending.set(outbox);
    this.outboxDeadLettered.set(deadLettered);
    this.payoutsPending.set(payouts._count);
    this.payoutsPendingAmount.set(Number(payouts._sum.amount ?? 0));

    this.paymentsLastHour.reset();
    let volume = 0;
    for (const row of payments) {
      this.paymentsLastHour.set({ status: row.status }, row._count);
      if (row.status === 'CAPTURED') volume += Number(row._sum.amount ?? 0);
    }
    this.paymentVolumeLastHour.set(volume);

    this.bonusAccruedLastHour.set(Number(bonus._sum.originalAmount ?? 0));
    this.walletsTotal.set(wallets);

    // Every defined sweep is reported whether or not it has a row, so a job
    // that has never run once is visible as -1 rather than absent from the
    // scrape — a missing series is indistinguishable from a healthy one on
    // most dashboards.
    const lastSweep = new Map(sweeps.map((row) => [row.name, row.lastSuccessAt.getTime()]));
    this.sweepAgeSeconds.reset();
    for (const sweep of SWEEPS) {
      const last = lastSweep.get(sweep.name);
      this.sweepAgeSeconds.set(
        { job: sweep.name },
        last === undefined ? -1 : (Date.now() - last) / 1000,
      );
    }

    if (lastRun) {
      const findings = Array.isArray(lastRun.findings) ? lastRun.findings.length : 0;
      this.reconciliationDrift.set(
        lastRun.status === ReconciliationStatus.DRIFT_DETECTED ? Math.max(findings, 1) : 0,
      );
      this.reconciliationAgeSeconds.set((Date.now() - lastRun.createdAt.getTime()) / 1000);
    } else {
      // Never run. -1 rather than 0, so "no reconciliation has ever
      // happened" cannot be mistaken for "reconciled seconds ago".
      this.reconciliationAgeSeconds.set(-1);
    }
  }
}
