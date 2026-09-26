import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerAccountType, PartnerSettlementStatus, PostingDirection, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PartnerSettlementService } from '../partner-settlements/partner-settlement.service';
import { SETTLEABLE_LEDGER_KINDS, TRANSFER_LEDGER_KINDS } from '../partner-settlements/settleable-kinds';
import { SettlementPeriodBounds, lastClosedPeriod, periodContaining } from '../partner-settlements/settlement-period';

/** How the settlement engine treats one PARTNER_PAYABLE posting. */
export type StatementLineClass = 'SETTLEABLE' | 'TRANSFER' | 'NOT_SETTLEABLE';

export interface StatementLine {
  postingId: string;
  postedAt: Date;
  account: LedgerAccountType;
  kind: string;
  sourceType: string;
  sourceId: string;
  direction: PostingDirection;
  amount: string;
  /** What the partner is owed by this line: CREDIT +, DEBIT −, on PARTNER_PAYABLE. */
  owedToPartner: string;
  classification: StatementLineClass;
  /** The PartnerSettlement that claimed it, if any — the only thing that pays it. */
  settlementId: string | null;
  settlementStatus: PartnerSettlementStatus | null;
}

const classify = (kind: string): StatementLineClass =>
  SETTLEABLE_LEDGER_KINDS.has(kind) ? 'SETTLEABLE' : TRANSFER_LEDGER_KINDS.has(kind) ? 'TRANSFER' : 'NOT_SETTLEABLE';

const ZERO = new Decimal(0);

/**
 * The partner's settlement statement (spec §50-52) — a *report*, never a
 * second settlement engine (docs/PARTNER_COMMERCE.md §14).
 *
 * `PartnerSettlementService` is the one authoritative engine: a posting is
 * paid only when a `PartnerSettlementEntry` claims it (unique
 * `ledgerPostingId`). This service claims nothing and stores nothing. For a
 * period of the partner's own cadence (`settlementPeriodicity`) it lists every
 * PARTNER_PAYABLE and PARTNER_DISPUTE_HOLD posting and, for each, the
 * settlement that claimed it — or that it is still unsettled, is itself a
 * transfer, or is a kind nobody classified (never paid, a reconciliation
 * finding). So "PARTNER_PAYABLE says X" is always explained line by line.
 *
 * The statements Partner Commerce used to generate (and their lines, which
 * claimed postings on their own) are kept as read-only history.
 */
@Injectable()
export class PartnerSettlementStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: PartnerSettlementService,
  ) {}

  private async cadence(partnerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, settlementPeriodicity: true, settlementAnchorDay: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  /** The statement of the period (of the partner's cadence) that contains `instant`. */
  async periodStatementAt(partnerId: string, instant: Date) {
    if (Number.isNaN(instant.getTime())) throw new BadRequestException('Invalid date');
    const partner = await this.cadence(partnerId);
    return this.periodStatement(partnerId, periodContaining(partner.settlementPeriodicity, partner.settlementAnchorDay, instant));
  }

  async periodStatement(partnerId: string, period: SettlementPeriodBounds) {
    const partner = await this.cadence(partnerId);
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        direction: PostingDirection;
        amount: Prisma.Decimal;
        accountType: LedgerAccountType;
        kind: string;
        sourceType: string;
        sourceId: string;
        postedAt: Date;
        settlementId: string | null;
        settlementStatus: PartnerSettlementStatus | null;
      }[]
    >`
      SELECT p.id, p.direction, p.amount, a.type AS "accountType", t.kind, t."sourceType", t."sourceId",
             t."postedAt", s.id AS "settlementId", s.status AS "settlementStatus"
        FROM ledger_postings p
        JOIN ledger_accounts a ON a.id = p."accountId"
        JOIN ledger_transactions t ON t.id = p."transactionId"
        LEFT JOIN partner_settlement_entries e ON e."ledgerPostingId" = p.id
        LEFT JOIN partner_settlements s ON s.id = e."settlementId"
       WHERE a."partnerId" = ${partnerId}
         AND a.type::text IN ('PARTNER_PAYABLE', 'PARTNER_DISPUTE_HOLD')
         AND t."postedAt" >= ${period.start}
         AND t."postedAt" < ${period.end}
       ORDER BY t."postedAt" ASC, p.id ASC
    `;
    const [opening] = await this.prisma.$queryRaw<{ owed: Prisma.Decimal | null }[]>`
      SELECT SUM(CASE WHEN p.direction = 'CREDIT' THEN p.amount ELSE -p.amount END) AS owed
        FROM ledger_postings p
        JOIN ledger_accounts a ON a.id = p."accountId"
        JOIN ledger_transactions t ON t.id = p."transactionId"
       WHERE a."partnerId" = ${partnerId} AND a.type::text = 'PARTNER_PAYABLE' AND t."postedAt" < ${period.start}
    `;

    let accrued = ZERO;
    let deducted = ZERO;
    let transfers = ZERO;
    let notSettleable = ZERO;
    let payableMovement = ZERO;
    let frozenMovement = ZERO;
    let settledNet = ZERO;
    const lines: StatementLine[] = rows.map((r) => {
      const amount = new Decimal(r.amount);
      const owed = r.direction === PostingDirection.CREDIT ? amount : amount.negated();
      const classification = classify(r.kind);
      if (r.accountType === LedgerAccountType.PARTNER_PAYABLE) {
        payableMovement = payableMovement.plus(owed);
        if (classification === 'SETTLEABLE') {
          if (owed.isPositive()) accrued = accrued.plus(owed);
          else deducted = deducted.plus(owed.negated());
          if (r.settlementId && r.settlementStatus !== PartnerSettlementStatus.CANCELLED) settledNet = settledNet.plus(owed);
        } else if (classification === 'TRANSFER') transfers = transfers.plus(owed);
        else notSettleable = notSettleable.plus(owed);
      } else {
        // PARTNER_DISPUTE_HOLD is credit-normal too: a CREDIT freezes.
        frozenMovement = frozenMovement.plus(owed);
      }
      return {
        postingId: r.id,
        postedAt: r.postedAt,
        account: r.accountType,
        kind: r.kind,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        direction: r.direction,
        amount: amount.toFixed(4),
        owedToPartner: owed.toFixed(4),
        classification,
        settlementId: r.settlementId,
        settlementStatus: r.settlementStatus,
      };
    });
    const openingOwed = new Decimal(opening?.owed ?? 0);
    const settlementIds = [...new Set(lines.map((l) => l.settlementId).filter((id): id is string => id !== null))];
    const settlements = settlementIds.length
      ? await this.prisma.partnerSettlement.findMany({
          where: { id: { in: settlementIds } },
          select: { id: true, status: true, periodStart: true, periodEnd: true, netPayableAmount: true, paidAt: true },
        })
      : [];
    return {
      partnerId,
      periodicity: partner.settlementPeriodicity,
      anchorDay: partner.settlementAnchorDay,
      periodStart: period.start,
      periodEnd: period.end,
      /** PARTNER_PAYABLE: what TuTak owed the partner (+) or the partner owed TuTak (−). */
      openingOwedToPartner: openingOwed.toFixed(4),
      closingOwedToPartner: openingOwed.plus(payableMovement).toFixed(4),
      totals: {
        accrued: accrued.toFixed(4),
        deducted: deducted.toFixed(4),
        settleableNet: accrued.minus(deducted).toFixed(4),
        /** Of the settleable net, the part a (non-cancelled) settlement already claimed. */
        claimedBySettlements: settledNet.toFixed(4),
        /** Money already moved between TuTak and the partner (payouts, settlement payments). */
        transfers: transfers.toFixed(4),
        /** Kinds nobody classified — never paid; a reconciliation finding. */
        notSettleable: notSettleable.toFixed(4),
        frozenForDisputes: frozenMovement.toFixed(4),
      },
      unrecognisedKinds: [...new Set(lines.filter((l) => l.classification === 'NOT_SETTLEABLE').map((l) => l.kind))].sort(),
      settlements: settlements.map((s) => ({ ...s, netPayableAmount: s.netPayableAmount.toFixed(4) })),
      lines,
    };
  }

  /** The partner's last `count` closed periods, newest first, as summaries. */
  async recentPeriods(partnerId: string, count = 6, now = new Date()) {
    const partner = await this.cadence(partnerId);
    const out = [];
    let period = lastClosedPeriod(partner.settlementPeriodicity, partner.settlementAnchorDay, now);
    for (let i = 0; i < count; i += 1) {
      const { lines: _lines, ...summary } = await this.periodStatement(partnerId, period);
      out.push(summary);
      period = periodContaining(partner.settlementPeriodicity, partner.settlementAnchorDay, new Date(period.start.getTime() - 1));
    }
    return out;
  }

  /** A statement generated before 20260927090000 — read-only history. */
  async legacyStatement(statementId: string) {
    const statement = await this.prisma.partnerSettlementStatement.findUnique({
      where: { id: statementId },
      include: { lines: { orderBy: { postedAt: 'asc' } } },
    });
    if (!statement) throw new NotFoundException('Statement not found');
    return statement;
  }

  /**
   * Spec §50/§77: what the partner sees — pending (reserved in escrow for
   * orders not yet received), frozen (dispute holds), due to the partner /
   * due to TuTak (the live PARTNER_PAYABLE balance), what the settlement
   * engine would pay now, and unconfirmed external payments. Read-only;
   * there is deliberately no withdraw.
   */
  async balanceSummary(partnerId: string) {
    const partner = await this.cadence(partnerId);
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { partnerId } });
    const raw = (type: LedgerAccountType) => accounts.find((a) => a.type === type)?.balance ?? ZERO;
    const payable = raw(LedgerAccountType.PARTNER_PAYABLE);
    const pendingExternal = await this.prisma.partnerOrderPaymentLeg.aggregate({
      where: { type: 'EXTERNAL', status: 'PENDING', order: { partnerId, operationalStatus: { notIn: ['CANCELLED', 'EXPIRED', 'DRAFT'] } } },
      _sum: { amount: true },
    });
    // Q8: commission refunds this partner is owed for returned purchases,
    // waiting on the referrer's future accruals (credited as repaid).
    const awaitingWithholding = await this.prisma.referralWithholding.aggregate({
      where: { beneficiaryPartnerId: partnerId, status: 'OPEN' },
      _sum: { remainingAmount: true },
    });
    const unsettled = await this.engine.unsettled(partnerId);
    const reservedMoney = raw(LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW).negated();
    const reservedDiscount = raw(LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW).negated();
    return {
      partnerId,
      settlementPeriodicity: partner.settlementPeriodicity,
      settlementAnchorDay: partner.settlementAnchorDay,
      reservedInEscrow: reservedMoney.plus(reservedDiscount).toFixed(4),
      reservedMoneyInEscrow: reservedMoney.toFixed(4),
      reservedDiscountInEscrow: reservedDiscount.toFixed(4),
      commissionRefundAwaitingWithholding: (awaitingWithholding._sum.remainingAmount ?? ZERO).toFixed(4),
      frozenForDisputes: raw(LedgerAccountType.PARTNER_DISPUTE_HOLD).negated().toFixed(4),
      dueToPartner: payable.isNegative() ? payable.negated().toFixed(4) : '0.0000',
      dueToTutak: payable.isPositive() ? payable.toFixed(4) : '0.0000',
      /** What the settlement engine would claim now (unclaimed settleable postings). */
      unsettledNet: unsettled.net.toFixed(4),
      unrecognisedKinds: unsettled.unrecognised,
      externalPaymentsAwaitingConfirmation: (pendingExternal._sum.amount ?? ZERO).toFixed(4),
      statements: await this.recentPeriods(partnerId, 6),
    };
  }
}
