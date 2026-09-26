import { Injectable, Logger } from '@nestjs/common';
import { Currency, LedgerAccountType, SettlementPeriod } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE } from '../../common/utils/money';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Doc §2: netting happens "periodically, e.g. every two weeks" — a target
 * cadence, not a promise every partner shares one calendar date. Partner
 * Commerce (spec §51, Q7b) makes the cadence each partner's own
 * `settlementPeriod`; every partner that existed before it was migrated to
 * BIWEEKLY, i.e. exactly the fixed fourteen days this sweep always used.
 * The window is still measured from the partner's own `lastSettledAt`: a
 * partner onboarded on a Tuesday is due on Tuesdays.
 */
export const SETTLEMENT_CYCLE_MS: Record<SettlementPeriod, number> = {
  DAILY: DAY_MS,
  WEEKLY: 7 * DAY_MS,
  BIWEEKLY: 14 * DAY_MS,
  MONTHLY: 30 * DAY_MS,
};

const PERIOD_LABEL: Record<SettlementPeriod, { title: string; span: string }> = {
  DAILY: { title: 'Daily', span: 'a day' },
  WEEKLY: { title: 'Weekly', span: 'a week' },
  BIWEEKLY: { title: 'Biweekly', span: 'two weeks' },
  MONTHLY: { title: 'Monthly', span: 'a month' },
};

export interface SettlementCheckResult {
  /** Active partners whose settlement window had elapsed. */
  checked: number;
  /** Of those, how many actually had a non-zero balance worth notifying about. */
  overdue: number;
}

/**
 * The biweekly settlement check — doc §2/§7's periodic netting, made visible.
 *
 * Read-only and notify-only by design. Nothing here moves a dram: it exists
 * to make sure a human looks at every partner whose `PARTNER_PAYABLE`
 * balance has gone two-plus weeks without netting back to zero. `duePartners`
 * below is only a candidate filter — the actual decision to alert always
 * re-reads the live balance, because `Partner.lastSettledAt` is not "the
 * last time a `Payout` or `PartnerCollection` happened" (a partial one of
 * either leaves this partner's balance non-zero and must not silence the
 * sweep). It is the start of the *current* cycle — the last time this
 * balance actually crossed zero, either direction — kept honest by
 * `LedgerService` itself on every posting that touches a `PARTNER_PAYABLE`
 * account, not by this sweep or by `PayoutEngineService`/
 * `PartnerCollectionService` reaching in to set it. Turning a real non-zero
 * balance into an actual transfer is still `PayoutEngineService` (TuTak owes
 * the partner) or `PartnerCollectionService` (the partner owes TuTak), both
 * of which already carry their own concurrency and idempotency guarantees;
 * duplicating any of that here would be building a second, less careful way
 * to move the same money.
 *
 * "Due" is evaluated per partner from their own `lastSettledAt`, not from a
 * single platform-wide date — see `SETTLEMENT_CYCLE_MS`'s docblock. The
 * sweep itself still runs on a fixed daily schedule (see its row in
 * `sweeps.jobs.ts`): the *polling* cadence is a calendar date, so that no
 * partner's own 14-day anniversary is missed by more than a day, but the
 * *selection* of which partners get notified on any given run is entirely
 * driven by each partner's own clock.
 *
 * Admin-only for this pass, deliberately. A partner-facing "you are due for
 * settlement" notice would need a new delivery channel this codebase does
 * not yet have wired to a partner-facing surface for a financial event (the
 * partner dashboard has no notification center — only the customer app
 * does, via `NotificationsModule`, and that is customer-scoped). Building
 * that plumbing is a larger, separate piece of work than "close the gap
 * where nobody currently finds out a settlement is due", and the brief's own
 * instruction was to lean toward the narrower scope. An admin already has
 * every partner's balance one click away in the payouts dashboard; what was
 * missing is being told to look, and `AlertsService` — the same mechanism
 * `RefundEngineService.warnIfPartnerNowOwesUs` already uses for the mirror
 * case — closes exactly that gap.
 */
@Injectable()
export class PartnerSettlementCheckService {
  private readonly logger = new Logger(PartnerSettlementCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async checkOverdueSettlements(): Promise<SettlementCheckResult> {
    const now = Date.now();
    // The shortest cycle bounds the candidate query; each partner's own
    // period then decides whether it is actually due.
    const cutoff = new Date(now - SETTLEMENT_CYCLE_MS.DAILY);

    // Null `lastSettledAt` is due immediately, same as a real 14-day-old
    // timestamp would be — see `Partner.lastSettledAt`'s own docblock. A
    // brand-new partner with a real balance must not go unnoticed just
    // because they have never been settled once.
    const candidates = await this.prisma.partner.findMany({
      where: {
        isActive: true,
        OR: [{ lastSettledAt: null }, { lastSettledAt: { lt: cutoff } }],
      },
      select: { id: true, displayName: true, lastSettledAt: true, settlementPeriod: true },
    });
    const duePartners = candidates.filter(
      (p) => p.lastSettledAt === null || p.lastSettledAt.getTime() < now - SETTLEMENT_CYCLE_MS[p.settlementPeriod],
    );

    if (duePartners.length === 0) {
      return { checked: 0, overdue: 0 };
    }

    // One query for every candidate's balance rather than one per partner —
    // the same shape `RefundEngineService`'s per-refund check does not need
    // to worry about, but a sweep touching every partner does.
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: {
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId: { in: duePartners.map((p) => p.id) },
        currency: Currency.AMD,
      },
    });
    const accountByPartner = new Map(accounts.filter((a) => a.partnerId).map((a) => [a.partnerId!, a]));

    let overdue = 0;
    for (const partner of duePartners) {
      const account = accountByPartner.get(partner.id);
      if (!account) continue;

      const raw = new Decimal(account.balance);
      if (raw.isZero()) continue;

      overdue += 1;
      await this.notify(partner.id, partner.displayName, raw, partner.lastSettledAt, partner.settlementPeriod);
    }

    this.logger.log(
      `Biweekly settlement check: ${duePartners.length} partner(s) due, ${overdue} with a real balance to net.`,
    );
    return { checked: duePartners.length, overdue };
  }

  /**
   * One alert per partner, not per run: `AlertsService.fire` suppresses a
   * repeat of the same key for fifteen minutes, so a partner still overdue
   * on tomorrow's run gets a fresh notification rather than being drowned
   * out — this is a daily poll over a two-week window, not a tight loop.
   */
  private async notify(
    partnerId: string,
    displayName: string,
    rawBalance: Decimal,
    lastSettledAt: Date | null,
    period: SettlementPeriod,
  ): Promise<void> {
    // Credit-normal: negated-positive means TuTak owes the partner (the
    // ordinary case — see `PayoutEngineService.availableBalance`); the raw
    // balance being positive means the partner owes TuTak (the case
    // `PartnerCollectionService.amountOwed` reports).
    const owedToPartner = rawBalance.negated();
    const direction = owedToPartner.isPositive() ? 'TuTak owes the partner' : 'the partner owes TuTak';
    const net = owedToPartner.abs().toFixed(MONEY_SCALE);
    const since = lastSettledAt ? lastSettledAt.toISOString() : 'never';

    try {
      await this.alerts.fire({
        severity: 'warning',
        key: `partner.settlement-due:${partnerId}`,
        title: `${PERIOD_LABEL[period].title} settlement due — ${displayName}`,
        body:
          `${displayName} (${partnerId}) has gone ${PERIOD_LABEL[period].span} or more without a settlement ` +
          `(last settled: ${since}). Net position: ${net} AMD — ${direction}. This is informational ` +
          'only — nothing has been transferred. Use a payout or a collection to net it.',
        context: {
          partnerId,
          netAmount: net,
          direction: owedToPartner.isPositive() ? 'tutak_owes_partner' : 'partner_owes_tutak',
          lastSettledAt: since,
        },
      });
    } catch (err) {
      // Same posture as `warnIfPartnerNowOwesUs`: a missed notification is
      // recoverable on the next run; this must never fail the sweep, which
      // would stop every other partner in the same batch from being checked.
      this.logger.warn(
        `Could not fire the settlement-due alert for partner ${partnerId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
