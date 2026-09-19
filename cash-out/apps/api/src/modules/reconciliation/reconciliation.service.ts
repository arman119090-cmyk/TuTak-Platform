import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, ReconciliationKind } from '@prisma/client';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { hasOutstandingDebit } from '@cashout/contracts';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentProviderPort } from '../payment-provider/payment-provider.port';
import { YandexFleetPort } from '../yandex/yandex.port';

export interface ReconciliationResult {
  readonly runId: string;
  readonly kind: ReconciliationKind;
  readonly scanned: number;
  readonly mismatches: number;
}

/**
 * Reconciliation: the part that decides whether the product is actually working.
 *
 * Everything else in this codebase is a claim — "we debited Yandex", "the bank
 * confirmed it", "the ledger balances". Reconciliation is where those claims are
 * checked against the systems that own the truth, on a schedule, whether or not
 * anyone suspects a problem. A payment product without it does not find out it
 * has been losing money until a driver complains.
 *
 * Three independent runs, because there are three independent things that can
 * disagree:
 *
 *  - `LEDGER` — our own books against themselves.
 *  - `YANDEX` — every debit we believe we made against the park's transactions.
 *  - `PROVIDER` — every transfer we believe settled against the bank's record.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly yandex: YandexFleetPort,
    private readonly provider: PaymentProviderPort,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduled(): Promise<void> {
    try {
      await this.runLedger();
      await this.runProvider();
      await this.runYandex();
    } catch (error) {
      this.logger.fail('Scheduled reconciliation failed', error);
    }
  }

  /**
   * Checks the ledger against itself:
   *   - debits equal credits, per currency, across the whole book;
   *   - no driver is owed a negative amount;
   *   - suspense is empty;
   *   - every withdrawal's entries match the state it claims to be in.
   */
  async runLedger(triggeredBy = 'SCHEDULE'): Promise<ReconciliationResult> {
    const run = await this.startRun('LEDGER', triggeredBy);
    let scanned = 0;
    let mismatches = 0;

    for (const row of await this.ledger.trialBalance()) {
      scanned += 1;
      if (row.difference !== 0n) {
        mismatches += 1;
        await this.recordMismatch(
          run.id,
          null,
          'trial_balance_not_zero',
          '0',
          String(row.difference),
          {
            currency: row.currency,
          },
        );
      }
    }

    const negativePayables = await this.prisma.$queryRaw<
      Array<{ key: string; currency: string; balance: bigint }>
    >`
      SELECT a.key, a.currency,
             COALESCE(SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountMinor" ELSE -p."amountMinor" END), 0)::bigint AS balance
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p."accountId"
      WHERE a.type = 'DRIVER_PAYABLE'
      GROUP BY a.key, a.currency
      HAVING SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountMinor" ELSE -p."amountMinor" END) < 0
    `;
    for (const row of negativePayables) {
      scanned += 1;
      mismatches += 1;
      await this.recordMismatch(
        run.id,
        null,
        'driver_payable_negative',
        '>=0',
        String(row.balance),
        {
          driverId: row.key,
          currency: row.currency,
        },
      );
    }

    // A completed withdrawal must have all three of its entries; a reversed one
    // must have its compensation. Anything else means a crash between a state
    // change and its bookkeeping.
    const finished = await this.prisma.withdrawal.findMany({
      where: { state: { in: ['COMPLETED', 'REVERSED'] } },
      select: { id: true, state: true, reference: true },
      take: 2000,
      orderBy: { updatedAt: 'desc' },
    });

    for (const withdrawal of finished) {
      scanned += 1;
      const entries = await this.prisma.journalEntry.findMany({
        where: { withdrawalId: withdrawal.id },
        select: { type: true },
      });
      const types = new Set(entries.map((entry) => entry.type));
      const required =
        withdrawal.state === 'COMPLETED'
          ? ['WITHDRAWAL_RESERVE', 'FEE_CAPTURE', 'PAYOUT_SETTLEMENT']
          : ['WITHDRAWAL_RESERVE', 'FEE_CAPTURE', 'COMPENSATION'];
      const missing = required.filter((type) => !types.has(type as never));
      if (missing.length > 0) {
        mismatches += 1;
        await this.recordMismatch(
          run.id,
          withdrawal.id,
          'missing_journal_entries',
          required.join(','),
          [...types].join(','),
          { reference: withdrawal.reference, missing },
        );
      }
    }

    return this.finishRun(run.id, 'LEDGER', scanned, mismatches);
  }

  /**
   * Every withdrawal we believe debited Yandex must have a matching transaction
   * in the park. A missing one means we paid out against a debit that does not
   * exist; an unexpected one means we debited twice.
   */
  async runYandex(triggeredBy = 'SCHEDULE', sinceHours = 48): Promise<ReconciliationResult> {
    const run = await this.startRun('YANDEX', triggeredBy);
    const since = new Date(this.clock.nowMs() - sinceHours * 3_600_000);
    let scanned = 0;
    let mismatches = 0;

    const candidates = await this.prisma.withdrawal.findMany({
      where: {
        createdAt: { gte: since },
        state: { in: ['RESERVED', 'PAYOUT_SUBMITTED', 'PAYOUT_CONFIRMED', 'COMPLETED'] },
      },
      take: 500,
    });

    for (const withdrawal of candidates) {
      scanned += 1;
      try {
        const transaction = await this.yandex.findTransaction(
          withdrawal.parkId,
          withdrawal.yandexContractorProfileId,
          withdrawal.reference,
          new Date(withdrawal.createdAt.getTime() - 60_000),
        );

        if (!transaction) {
          mismatches += 1;
          await this.recordMismatch(
            run.id,
            withdrawal.id,
            'yandex_debit_missing',
            withdrawal.grossMinor.toString(),
            'none',
            { reference: withdrawal.reference },
          );
          continue;
        }

        const expected = Money.fromMinor(
          -withdrawal.grossMinor,
          withdrawal.currency as CurrencyCode,
        );
        if (!transaction.amount.equals(expected)) {
          mismatches += 1;
          await this.recordMismatch(
            run.id,
            withdrawal.id,
            'yandex_debit_amount_mismatch',
            expected.toDecimalString(),
            transaction.amount.toDecimalString(),
            { reference: withdrawal.reference },
          );
        }
      } catch (error) {
        this.logger.fail('Yandex reconciliation probe failed', error, {
          withdrawalId: withdrawal.id,
        });
      }
    }

    return this.finishRun(run.id, 'YANDEX', scanned, mismatches);
  }

  /** The same question asked of the bank. */
  async runProvider(triggeredBy = 'SCHEDULE', sinceHours = 48): Promise<ReconciliationResult> {
    const run = await this.startRun('PROVIDER', triggeredBy);
    const since = new Date(this.clock.nowMs() - sinceHours * 3_600_000);
    let scanned = 0;
    let mismatches = 0;

    const candidates = await this.prisma.withdrawal.findMany({
      where: {
        createdAt: { gte: since },
        providerIdempotencyKey: { not: '' },
        state: { in: ['PAYOUT_SUBMITTED', 'PAYOUT_CONFIRMED', 'COMPLETED', 'REVERSED'] },
      },
      take: 500,
    });

    for (const withdrawal of candidates) {
      scanned += 1;
      const outcome = await this.provider.probe(withdrawal.providerIdempotencyKey);
      const expectedSettled =
        withdrawal.state === 'COMPLETED' || withdrawal.state === 'PAYOUT_CONFIRMED';

      if (expectedSettled && outcome.status !== 'CONFIRMED') {
        mismatches += 1;
        await this.recordMismatch(
          run.id,
          withdrawal.id,
          'provider_not_settled',
          'CONFIRMED',
          outcome.status,
          { reference: withdrawal.reference },
        );
      }

      if (withdrawal.state === 'REVERSED' && outcome.status === 'CONFIRMED') {
        // We told the driver it failed and gave the money back, but the bank
        // says it went through. This one is money out of the door twice.
        mismatches += 1;
        await this.recordMismatch(
          run.id,
          withdrawal.id,
          'reversed_but_provider_settled',
          'REJECTED',
          'CONFIRMED',
          { reference: withdrawal.reference, severity: 'critical' },
        );
      }
    }

    return this.finishRun(run.id, 'PROVIDER', scanned, mismatches);
  }

  /**
   * Withdrawals that hold a debit and have stopped moving. Rendered as the
   * admin dashboard's first tile, because it is the number that says whether
   * anyone's money is stuck right now.
   */
  async stuck(olderThanSeconds = 900) {
    const cutoff = new Date(this.clock.nowMs() - olderThanSeconds * 1000);
    const rows = await this.prisma.withdrawal.findMany({
      where: {
        updatedAt: { lt: cutoff },
        state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    return rows.filter((row) => hasOutstandingDebit(row.state));
  }

  async openMismatches(limit = 100) {
    return this.prisma.reconciliationMismatch.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { run: true },
    });
  }

  async resolveMismatch(id: string, note: string): Promise<void> {
    await this.prisma.reconciliationMismatch.update({
      where: { id },
      data: { resolvedAt: this.clock.now(), resolutionNote: note },
    });
  }

  private async startRun(kind: ReconciliationKind, triggeredBy: string) {
    return this.prisma.reconciliationRun.create({ data: { kind, triggeredBy } });
  }

  private async finishRun(
    runId: string,
    kind: ReconciliationKind,
    scanned: number,
    mismatches: number,
  ): Promise<ReconciliationResult> {
    await this.prisma.reconciliationRun.update({
      where: { id: runId },
      data: {
        finishedAt: this.clock.now(),
        status: mismatches === 0 ? 'CLEAN' : 'MISMATCHES',
        scannedCount: scanned,
        mismatchCount: mismatches,
      },
    });

    if (mismatches > 0) {
      this.logger.warning('Reconciliation found mismatches', { kind, scanned, mismatches });
    }

    return { runId, kind, scanned, mismatches };
  }

  private async recordMismatch(
    runId: string,
    withdrawalId: string | null,
    kind: string,
    expected: string,
    actual: string,
    detail: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.reconciliationMismatch.create({
      data: { runId, withdrawalId, kind, expected, actual, detail },
    });
  }
}
