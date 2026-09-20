import { Injectable, Logger } from '@nestjs/common';
import {
  BalanceTopUpStatus,
  Currency,
  ExternalRefundStatus,
  FraudSignalSeverity,
  FraudSignalType,
  LedgerAccountType,
  PartnerSettlementStatus,
  PostingDirection,
  Prisma,
  PurchaseIntentStatus,
  ReconciliationStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  SETTLEABLE_LEDGER_KINDS,
  TRANSFER_LEDGER_KINDS,
} from '../partner-settlements/settleable-kinds';
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
    // The hybrid-funding invariants (brief §32 A–E, 20.09.2026). Same
    // posture as the check above: nothing is corrected, every disagreement
    // is a finding, and a finding blocks the partner it names.
    findings.push(...(await this.checkHybridInvariants()));
    await this.alertStaleExternalRefunds();

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

  /**
   * The hybrid-funding invariants, each provable from two independent
   * records that must agree (brief §32):
   *
   *  A. completed top-ups vs the credits they posted to customers' balances;
   *  B. every customer's book balance vs a replay of both balance accounts
   *     (the generic materialised-vs-postings check covers each account; this
   *     one adds that available can never be negative);
   *  C. what open purchases say they hold vs the reserved account;
   *  D. what confirmed purchases say TuTak funded (prepaid, bonus), net of
   *     refunds, vs the partner-payable postings that funded it;
   *  E. each partner's ledger balance vs the settlement engine's own view of
   *     where that balance is (unclaimed + open + under review).
   *
   * F — bank/PSP records vs the platform accounts — is the statement
   * comparison `reconcile` already does when a statement is supplied.
   */
  private async checkHybridInvariants(): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    const zero = new Decimal(0);
    const signedSum = (
      rows: { amount: Decimal; direction: PostingDirection }[],
      positive: PostingDirection,
    ) => rows.reduce((s, r) => (r.direction === positive ? s.plus(r.amount) : s.minus(r.amount)), zero);
    const push = (account: string, expected: Decimal, reported: Decimal, partnerId?: string) => {
      const drift = reported.minus(expected);
      if (drift.abs().greaterThanOrEqualTo(ReconciliationService.TOLERANCE)) {
        findings.push({
          account,
          partnerId,
          expected: expected.toFixed(MONEY_SCALE),
          reported: reported.toFixed(MONEY_SCALE),
          drift: drift.toFixed(MONEY_SCALE),
        });
      }
    };

    // A. Completed top-ups vs the credits on customers' balances.
    const [topUps, topUpCredits] = await Promise.all([
      this.prisma.balanceTopUp.aggregate({ where: { status: BalanceTopUpStatus.COMPLETED }, _sum: { amount: true } }),
      this.prisma.ledgerPosting.findMany({
        where: {
          transaction: { kind: 'balance.topup.completed' },
          account: { type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE },
        },
        select: { amount: true, direction: true },
      }),
    ]);
    push('TOPUPS:completed-vs-balance-credits', topUps._sum.amount ?? zero, signedSum(topUpCredits, PostingDirection.CREDIT));

    // B. No customer's available balance is negative — a hold that
    // oversubscribed, if one ever did, shows here before anywhere else.
    const negative = await this.prisma.ledgerAccount.findMany({
      where: { type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, balance: { gt: zero } },
      select: { id: true, balance: true },
    });
    for (const account of negative) {
      push(`CUSTOMER_PREPAID_BALANCE:${account.id}:available-not-negative`, zero, account.balance.negated());
    }

    // C. Open purchases' holds vs the reserved accounts, per customer.
    const [openHolds, reservedAccounts] = await Promise.all([
      this.prisma.purchaseIntent.groupBy({
        by: ['customerId'],
        where: { status: PurchaseIntentStatus.AWAITING_CONFIRMATION, prepaidAmountApplied: { gt: zero } },
        _sum: { prepaidAmountApplied: true },
      }),
      this.prisma.ledgerAccount.findMany({
        where: { type: LedgerAccountType.CUSTOMER_PREPAID_RESERVED },
        select: { userId: true, balance: true },
      }),
    ]);
    const heldByCustomer = new Map(openHolds.map((row) => [row.customerId, row._sum.prepaidAmountApplied ?? zero]));
    const reservedByCustomer = new Map(reservedAccounts.map((a) => [a.userId!, a.balance.negated()]));
    for (const userId of new Set([...heldByCustomer.keys(), ...reservedByCustomer.keys()])) {
      push(
        `CUSTOMER_PREPAID_RESERVED:${userId}:open-holds-vs-reserved`,
        heldByCustomer.get(userId) ?? zero,
        reservedByCustomer.get(userId) ?? zero,
      );
    }

    // D. What confirmed purchases say TuTak funded, net of refunds, vs the
    // partner-payable postings that funded it — per partner, per component.
    const [confirmedByPartner, refundsByIntent, fundingPostings] = await Promise.all([
      this.prisma.purchaseIntent.groupBy({
        by: ['partnerId'],
        where: { status: PurchaseIntentStatus.CONFIRMED },
        _sum: { prepaidAmountApplied: true, bonusAmountRequested: true },
      }),
      this.prisma.purchaseIntentRefund.findMany({
        select: { prepaidRestored: true, bonusRestored: true, purchaseIntent: { select: { partnerId: true } } },
      }),
      this.prisma.ledgerPosting.findMany({
        where: {
          account: { type: LedgerAccountType.PARTNER_PAYABLE },
          transaction: {
            kind: {
              in: [
                'partner.prepaid_funding',
                'partner.prepaid_funding_refund',
                'partner.bonus_redemption_compensation',
                'partner.bonus_redemption_compensation_refund',
              ],
            },
          },
        },
        select: { amount: true, direction: true, account: { select: { partnerId: true } }, transaction: { select: { kind: true } } },
      }),
    ]);
    const expectedPrepaid = new Map<string, Decimal>();
    const expectedBonus = new Map<string, Decimal>();
    for (const row of confirmedByPartner) {
      expectedPrepaid.set(row.partnerId, row._sum.prepaidAmountApplied ?? zero);
      expectedBonus.set(row.partnerId, row._sum.bonusAmountRequested ?? zero);
    }
    for (const refund of refundsByIntent) {
      const pid = refund.purchaseIntent.partnerId;
      expectedPrepaid.set(pid, (expectedPrepaid.get(pid) ?? zero).minus(refund.prepaidRestored));
      expectedBonus.set(pid, (expectedBonus.get(pid) ?? zero).minus(refund.bonusRestored));
    }
    const postedPrepaid = new Map<string, Decimal>();
    const postedBonus = new Map<string, Decimal>();
    for (const posting of fundingPostings) {
      const pid = posting.account.partnerId!;
      const delta = posting.direction === PostingDirection.CREDIT ? posting.amount : posting.amount.negated();
      const target = posting.transaction.kind.startsWith('partner.prepaid_funding') ? postedPrepaid : postedBonus;
      target.set(pid, (target.get(pid) ?? zero).plus(delta));
    }
    for (const pid of new Set([...expectedPrepaid.keys(), ...postedPrepaid.keys()])) {
      push('PARTNER_PAYABLE:prepaid-funding-vs-purchases', expectedPrepaid.get(pid) ?? zero, postedPrepaid.get(pid) ?? zero, pid);
    }
    for (const pid of new Set([...expectedBonus.keys(), ...postedBonus.keys()])) {
      push('PARTNER_PAYABLE:bonus-compensation-vs-purchases', expectedBonus.get(pid) ?? zero, postedBonus.get(pid) ?? zero, pid);
    }

    // E. Each partner's ledger balance vs where the settlement engine says
    // it is: unclaimed settleable postings + open settlements + under
    // review. PAID settlements are history and are deliberately not added.
    const payables = await this.prisma.ledgerAccount.findMany({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: { not: null } },
      select: { id: true, partnerId: true, balance: true },
    });
    for (const account of payables) {
      const [unclaimed, settlements] = await Promise.all([
        this.prisma.ledgerPosting.findMany({
          where: { accountId: account.id, settlementEntry: null },
          select: { amount: true, direction: true, transaction: { select: { kind: true } } },
        }),
        this.prisma.partnerSettlement.findMany({
          where: {
            partnerId: account.partnerId!,
            status: {
              in: [
                PartnerSettlementStatus.DRAFT,
                PartnerSettlementStatus.READY,
                PartnerSettlementStatus.APPROVED,
                PartnerSettlementStatus.PAYMENT_PENDING,
                PartnerSettlementStatus.FAILED,
                PartnerSettlementStatus.REQUIRES_RECONCILIATION,
              ],
            },
          },
          select: { netPayableAmount: true },
        }),
      ]);
      // Only kinds the settlement engine would claim count as "not yet in a
      // settlement"; transfer kinds (payouts, collections, paid settlements)
      // are money already moving and sit outside the identity by design.
      const unclaimedNet = signedSum(
        unclaimed.filter((p) => SETTLEABLE_LEDGER_KINDS.has(p.transaction.kind)),
        PostingDirection.CREDIT,
      );
      const transfers = signedSum(
        unclaimed.filter((p) => TRANSFER_LEDGER_KINDS.has(p.transaction.kind)),
        PostingDirection.CREDIT,
      );
      const unknown = unclaimed.filter(
        (p) => !SETTLEABLE_LEDGER_KINDS.has(p.transaction.kind) && !TRANSFER_LEDGER_KINDS.has(p.transaction.kind),
      );
      if (unknown.length > 0) {
        // Not silently ignored (§32): a posting nobody classified is a
        // finding in its own right, drift or no drift.
        push(`PARTNER_PAYABLE:unclassified-postings(${[...new Set(unknown.map((p) => p.transaction.kind))].join(',')})`, zero, new Decimal(unknown.length), account.partnerId!);
      }
      const inSettlements = settlements.reduce((s, row) => s.plus(row.netPayableAmount), zero);
      push(
        'PARTNER_PAYABLE:ledger-vs-settlement-view',
        unclaimedNet.plus(inSettlements).plus(transfers),
        account.balance.negated(),
        account.partnerId!,
      );
    }

    return findings;
  }

  /**
   * §33 "refund requiring reconciliation": a refund whose cash slice the
   * business has not confirmed handing back for a week is a customer who
   * may still be out of pocket. A warning, not a finding — nothing on the
   * ledger disagrees, somebody just has not said what happened.
   */
  private async alertStaleExternalRefunds(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const stale = await this.prisma.purchaseIntentRefund.findMany({
      where: { externalRefundStatus: ExternalRefundStatus.PENDING_PARTNER, createdAt: { lt: cutoff } },
      select: { id: true, externalRefundDue: true, purchaseIntent: { select: { partnerId: true } } },
    });
    if (stale.length === 0) return;
    const total = stale.reduce((s, r) => s.plus(r.externalRefundDue), new Decimal(0));
    await this.alerts.fire({
      severity: 'warning',
      key: `refund.external-pending:${new Date().toISOString().slice(0, 10)}`,
      title: `${stale.length} refund(s) still awaiting the partner's cash return`,
      body:
        `${stale.length} refund(s) totalling ${total.toFixed(MONEY_SCALE)} AMD have had their bonus and balance ` +
        'slices returned by TuTak for over 7 days without the business confirming the cash slice. ' +
        'Chase the partners; do not mark them confirmed by hand.',
      context: {
        refunds: stale.length,
        partners: [...new Set(stale.map((r) => r.purchaseIntent.partnerId))].join(','),
      },
    });
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
