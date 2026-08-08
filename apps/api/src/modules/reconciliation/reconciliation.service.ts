import { Injectable, Logger } from '@nestjs/common';
import {
  Currency,
  FraudSignalSeverity,
  FraudSignalType,
  LedgerAccountType,
  Prisma,
  ReconciliationStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';

/** What an external party says they hold, for one day. */
export interface ExternalStatement {
  /** UTC midnight of the day this statement covers. */
  periodStart: Date;
  /** The acquirer's reported receivable balance. */
  pspReceivable?: Decimal | string | number;
  /**
   * What the platform's own bank says is in the account.
   *
   * Only meaningful once acquirer settlements are being recorded — before
   * that, PLATFORM_BANK carries payouts out with nothing in, so it disagrees
   * with any real statement by construction. Omit it and the check is
   * skipped, which is the right default while that half is still being
   * entered by hand.
   */
  platformBank?: Decimal | string | number;
  /** Per-partner balances the bank reports as owed. */
  partnerPayables?: Array<{ partnerId: string; amount: Decimal | string | number }>;
}

export interface ReconciliationFinding {
  account: string;
  partnerId?: string;
  expected: string;
  reported: string;
  drift: string;
}

export interface ReconciliationResult {
  runId: string;
  status: ReconciliationStatus;
  findings: ReconciliationFinding[];
  partnersBlocked: string[];
}

/**
 * Nightly comparison of the ledger against what external parties say they
 * hold.
 *
 * The single most important decision in this file is what it does *not* do:
 * it never adjusts a balance to match a statement. A reconciliation engine
 * that silently corrects drift destroys the evidence of the bug it exists to
 * find, and turns a detectable one-off into a permanent, invisible loss.
 * Drift is recorded, raised as a fraud signal, and — for a partner — blocks
 * their payouts until a human has looked. Refusing to pay out against a
 * balance known to be wrong is the correct failure: the money is still there,
 * it is merely not moving yet.
 *
 * Both statement inputs are optional. Neither acquirer nor bank feed exists
 * yet (no PSP contract, no bank integration), so in practice this runs today
 * as an internal-consistency check — every account's materialized balance
 * replayed against its own postings — which is worth running on its own and
 * needs no external party at all.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  /** Sub-unit noise is not drift. Anything at or above this is. */
  private static readonly TOLERANCE = new Decimal('0.0001');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly alerts: AlertsService,
  ) {}

  async reconcile(
    statement: ExternalStatement,
    currency: Currency = Currency.AMD,
  ): Promise<ReconciliationResult> {
    const findings: ReconciliationFinding[] = [];

    // 1. Internal consistency, which needs no external party: every
    //    materialized balance must equal a replay of its own postings. A
    //    mismatch here means the ledger disagrees with itself, which is
    //    strictly worse than disagreeing with a bank.
    findings.push(...(await this.checkInternalConsistency()));

    // 2. The acquirer's receivable against ours.
    if (statement.pspReceivable !== undefined) {
      const finding = await this.compareAccount({
        label: 'PSP_RECEIVABLE',
        type: LedgerAccountType.PSP_RECEIVABLE,
        currency,
        reported: new Decimal(statement.pspReceivable),
      });
      if (finding) findings.push(finding);
    }

    // 3. The platform's own bank account.
    //
    //    This is the check that only became possible once the inbound half
    //    of the cash cycle was modelled: the acquirer settling
    //    PSP_RECEIVABLE into PLATFORM_BANK. Without those entries this
    //    account only ever went down and could not be compared with
    //    anything.
    if (statement.platformBank !== undefined) {
      const finding = await this.compareAccount({
        label: 'PLATFORM_BANK',
        type: LedgerAccountType.PLATFORM_BANK,
        currency,
        reported: new Decimal(statement.platformBank),
      });
      if (finding) findings.push(finding);
    }

    // 4. Each partner's payable against the bank's view.
    for (const reported of statement.partnerPayables ?? []) {
      const finding = await this.compareAccount({
        label: 'PARTNER_PAYABLE',
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId: reported.partnerId,
        currency,
        // Credit-normal: what we owe is stored negative, but a bank states it
        // as a positive amount owed.
        reported: new Decimal(reported.amount).negated(),
      });
      if (finding) findings.push(finding);
    }

    const status = findings.length
      ? ReconciliationStatus.DRIFT_DETECTED
      : ReconciliationStatus.CLEAN;

    const run = await this.recordRun(statement.periodStart, status, findings);
    const partnersBlocked = await this.escalate(findings);

    if (findings.length) {
      this.logger.error(
        `Reconciliation for ${statement.periodStart.toISOString()} found ${findings.length} discrepancies`,
      );

      // The single most important alert this platform sends. Reconciliation
      // finding drift means the ledger disagrees with itself or with a bank
      // — money is either missing or double-counted, and every hour nobody
      // knows is an hour of transactions built on top of the discrepancy.
      // Blocked partners are named because that is the customer-visible
      // consequence someone will be asked about first.
      await this.alerts.fire({
        severity: 'critical',
        key: `reconciliation.drift:${run.id}`,
        title: 'Reconciliation found a discrepancy',
        body:
          `${findings.length} account(s) disagree for the period starting ` +
          `${statement.periodStart.toISOString()}. Payouts are blocked for any partner ` +
          'involved until a human resolves it.',
        context: {
          runId: run.id,
          findings: findings.length,
          partnersBlocked: partnersBlocked.length,
          worstDrift: findings
            .map((f) => f.drift)
            .sort((a, b) => Math.abs(Number(b)) - Math.abs(Number(a)))[0] ?? '0',
        },
      });
    } else {
      this.logger.log(`Reconciliation for ${statement.periodStart.toISOString()} is clean`);
    }

    return { runId: run.id, status, findings, partnersBlocked };
  }

  /**
   * Replays every account against its own postings.
   *
   * `assertLedgerIntegrity` in the test suite asserts exactly this after every
   * operation; this is the same check, run in production against real data,
   * where no test fixture can reach.
   */
  private async checkInternalConsistency(): Promise<ReconciliationFinding[]> {
    const accounts = await this.prisma.ledgerAccount.findMany();
    const findings: ReconciliationFinding[] = [];

    for (const account of accounts) {
      const replayed = await this.ledger.replayBalance(account.id);
      const drift = account.balance.minus(replayed);
      if (drift.abs().greaterThanOrEqualTo(ReconciliationService.TOLERANCE)) {
        findings.push({
          account: `${account.type}:materialized-vs-postings`,
          partnerId: account.partnerId ?? undefined,
          expected: replayed.toFixed(MONEY_SCALE),
          reported: account.balance.toFixed(MONEY_SCALE),
          drift: drift.toFixed(MONEY_SCALE),
        });
      }
    }

    return findings;
  }

  private async compareAccount(params: {
    label: string;
    type: LedgerAccountType;
    partnerId?: string;
    currency: Currency;
    reported: Decimal;
  }): Promise<ReconciliationFinding | null> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: {
        type: params.type,
        partnerId: params.partnerId ?? null,
        currency: params.currency,
      },
    });

    const expected = account?.balance ?? new Decimal(0);
    const drift = expected.minus(params.reported);
    if (drift.abs().lessThan(ReconciliationService.TOLERANCE)) return null;

    return {
      account: params.label,
      partnerId: params.partnerId,
      expected: expected.toFixed(MONEY_SCALE),
      reported: params.reported.toFixed(MONEY_SCALE),
      drift: drift.toFixed(MONEY_SCALE),
    };
  }

  /**
   * One run per day. Re-running the same day overwrites its findings rather
   * than accumulating duplicates — the latest comparison is the useful one.
   */
  private async recordRun(
    periodStart: Date,
    status: ReconciliationStatus,
    findings: ReconciliationFinding[],
  ) {
    const payload = findings as unknown as Prisma.InputJsonValue;
    return this.prisma.reconciliationRun.upsert({
      where: { periodStart },
      update: { status, findings: payload },
      create: { periodStart, status, findings: payload },
    });
  }

  /**
   * Raises the alarm and stops the money.
   *
   * A partner whose balance is in dispute has their payouts blocked; drift on
   * a platform-wide account raises a signal but blocks nothing, because there
   * is no single party to hold it against and halting every payout on the
   * platform is a bigger outage than the discrepancy.
   */
  private async escalate(findings: ReconciliationFinding[]): Promise<string[]> {
    if (findings.length === 0) return [];

    await this.prisma.fraudSignal.create({
      data: {
        type: FraudSignalType.SETTLEMENT_DRIFT,
        severity: FraudSignalSeverity.HIGH,
        metadata: { findings } as unknown as Prisma.InputJsonValue,
      },
    });

    const partnerIds = [...new Set(findings.map((f) => f.partnerId).filter(Boolean))] as string[];
    if (partnerIds.length === 0) return [];

    await this.prisma.partner.updateMany({
      where: { id: { in: partnerIds }, payoutsBlockedAt: null },
      data: {
        payoutsBlockedAt: new Date(),
        payoutsBlockedReason: 'Ledger balance disagrees with the bank statement',
      },
    });

    this.logger.error(`Payouts blocked for partners: ${partnerIds.join(', ')}`);
    return partnerIds;
  }

  /**
   * Clears a payout block after a human has resolved the discrepancy.
   *
   * Deliberately manual and deliberately not part of `reconcile`: an engine
   * that both raises and clears its own blocks can talk itself out of a real
   * problem.
   */
  async clearPayoutBlock(partnerId: string, clearedByUserId: string): Promise<void> {
    await this.prisma.partner.update({
      where: { id: partnerId },
      data: { payoutsBlockedAt: null, payoutsBlockedReason: null },
    });
    this.logger.warn(`Payout block cleared for partner ${partnerId} by ${clearedByUserId}`);
  }

  listRuns(limit = 30) {
    return this.prisma.reconciliationRun.findMany({
      orderBy: { periodStart: 'desc' },
      take: limit,
    });
  }
}
