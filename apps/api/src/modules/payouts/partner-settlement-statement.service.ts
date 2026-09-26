import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, LedgerAccountType, PartnerSettlementStatement, Prisma, SettlementPeriod } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Settlement periods are cut on Armenian wall-clock boundaries. */
export const SETTLEMENT_TIME_ZONE = 'Asia/Yerevan';
/** BIWEEKLY periods are consecutive 14-day blocks counted from this Monday. */
const BIWEEKLY_ANCHOR = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

/** The UTC instant of a wall-clock midnight in `timeZone`. */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month, day);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess));
  const f = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(f('year'), f('month') - 1, f('day'), f('hour'), f('minute'));
  return new Date(guess - (asUtc - guess));
}

function localDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const f = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: f('year'), month: f('month') - 1, day: f('day') };
}

/**
 * The start of the period containing `instant` — a pure function of the
 * period type and the wall clock, so every worker computes the same
 * boundaries.
 */
export function periodStartFor(instant: Date, period: SettlementPeriod, timeZone = SETTLEMENT_TIME_ZONE): Date {
  const { year, month, day } = localDate(instant, timeZone);
  switch (period) {
    case SettlementPeriod.DAILY:
      return zonedMidnight(year, month, day, timeZone);
    case SettlementPeriod.MONTHLY:
      return zonedMidnight(year, month, 1, timeZone);
    case SettlementPeriod.WEEKLY:
    case SettlementPeriod.BIWEEKLY: {
      const civil = Date.UTC(year, month, day);
      const weekday = (new Date(civil).getUTCDay() + 6) % 7; // Monday = 0
      let monday = civil - weekday * DAY_MS;
      if (period === SettlementPeriod.BIWEEKLY) {
        const weeks = Math.floor((monday - BIWEEKLY_ANCHOR) / (7 * DAY_MS));
        if (weeks % 2 !== 0) monday -= 7 * DAY_MS;
      }
      const d = new Date(monday);
      return zonedMidnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), timeZone);
    }
  }
}

const SIGN = (direction: string, amount: Decimal) => (direction === 'DEBIT' ? amount : amount.negated());

/**
 * Partner settlement statements (spec §50-52, Q7b). At the end of each of a
 * partner's own settlement periods a statement is generated *from the
 * ledger*: every PARTNER_PAYABLE and PARTNER_DISPUTE_HOLD posting of that
 * partner not yet on any statement becomes one line. The statement never
 * stores a number whose origin cannot be proven: `closingBalance =
 * openingBalance + Σ PARTNER_PAYABLE lines`, recomputable at any time, and a
 * posting can be on at most one statement (unique `postingId`).
 *
 * It covers everything spec §52 lists because all of it is already a
 * posting on those two accounts: electronic receivables released at
 * completion, commissions (the contribution postings), refunds and their
 * reversals, dispute holds and releases, partner debt (a positive balance),
 * payouts and collections (previous settlements). External money the
 * partner received directly never touched TuTak's ledger — it is already
 * the partner's — and shows up only as the commission it was charged.
 *
 * Generating a statement moves no money: payouts and collections remain
 * the existing dual-control flows, and a partner has no "withdraw". Two
 * workers generating the same period race on the unique (partner,
 * periodStart); the loser returns the winner's statement.
 */
@Injectable()
export class PartnerSettlementStatementService {
  private readonly logger = new Logger(PartnerSettlementStatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Sweep: one statement for every partner whose latest period has ended. */
  async generateDue(now = new Date()): Promise<number> {
    const partners = await this.prisma.partner.findMany({ select: { id: true, settlementPeriod: true, createdAt: true } });
    let generated = 0;
    for (const partner of partners) {
      const periodEnd = periodStartFor(now, partner.settlementPeriod);
      const last = await this.prisma.partnerSettlementStatement.findFirst({
        where: { partnerId: partner.id },
        orderBy: { periodEnd: 'desc' },
      });
      if (last && last.periodEnd >= periodEnd) continue;
      const periodStart = last?.periodEnd ?? periodStartFor(partner.createdAt, partner.settlementPeriod);
      if (periodStart >= periodEnd) continue;
      const statement = await this.generate(partner.id, partner.settlementPeriod, periodStart, periodEnd);
      if (statement) generated += 1;
    }
    return generated;
  }

  async generate(partnerId: string, period: SettlementPeriod, periodStart: Date, periodEnd: Date): Promise<PartnerSettlementStatement | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const previous = await tx.partnerSettlementStatement.findFirst({
          where: { partnerId, periodEnd: { lte: periodStart } },
          orderBy: { periodEnd: 'desc' },
        });
        const statement = await tx.partnerSettlementStatement.create({
          data: {
            partnerId,
            period,
            periodStart,
            periodEnd,
            openingBalance: previous?.closingBalance ?? 0,
            closingBalance: previous?.closingBalance ?? 0,
            frozenBalance: previous?.frozenBalance ?? 0,
            totalsByKind: {},
          },
        });

        // Every posting before the cut-off not already on a statement — a
        // posting that committed late for an earlier period is picked up
        // here rather than lost.
        const postings = await tx.$queryRaw<
          {
            id: string;
            direction: string;
            amount: Prisma.Decimal;
            createdAt: Date;
            accountType: LedgerAccountType;
            transactionId: string;
            kind: string;
            sourceType: string;
            sourceId: string;
          }[]
        >`
          SELECT p.id, p.direction::text AS direction, p.amount, p."createdAt",
                 a.type AS "accountType", t.id AS "transactionId", t.kind, t."sourceType", t."sourceId"
            FROM ledger_postings p
            JOIN ledger_accounts a ON a.id = p."accountId"
            JOIN ledger_transactions t ON t.id = p."transactionId"
           WHERE a."partnerId" = ${partnerId}
             AND a.type::text IN ('PARTNER_PAYABLE', 'PARTNER_DISPUTE_HOLD')
             AND p."createdAt" < ${periodEnd}
             AND NOT EXISTS (SELECT 1 FROM partner_settlement_statement_lines l WHERE l."postingId" = p.id)
           ORDER BY p."createdAt" ASC, p.id ASC
        `;

        let payableDelta = new Decimal(0);
        let holdDelta = new Decimal(0);
        const totals: Record<string, Decimal> = {};
        for (const p of postings) {
          const signed = SIGN(p.direction, new Decimal(p.amount));
          await tx.partnerSettlementStatementLine.create({
            data: {
              statementId: statement.id,
              postingId: p.id,
              ledgerTransactionId: p.transactionId,
              accountType: p.accountType,
              kind: p.kind,
              sourceType: p.sourceType,
              sourceId: p.sourceId,
              signedAmount: signed,
              postedAt: p.createdAt,
            },
          });
          if (p.accountType === LedgerAccountType.PARTNER_PAYABLE) {
            payableDelta = payableDelta.plus(signed);
            totals[p.kind] = (totals[p.kind] ?? new Decimal(0)).plus(signed);
          } else {
            holdDelta = holdDelta.plus(signed);
            totals[`hold:${p.kind}`] = (totals[`hold:${p.kind}`] ?? new Decimal(0)).plus(signed);
          }
        }

        const saved = await tx.partnerSettlementStatement.update({
          where: { id: statement.id },
          data: {
            closingBalance: statement.openingBalance.plus(payableDelta),
            frozenBalance: statement.frozenBalance.plus(holdDelta),
            totalsByKind: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(4)])),
          },
        });
        await this.auditService.record(
          {
            action: AuditAction.SETTLEMENT_STATEMENT_GENERATED,
            entityType: 'PartnerSettlementStatement',
            entityId: saved.id,
            metadata: { partnerId, period, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), lines: postings.length },
          },
          tx,
        );
        return saved;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.partnerSettlementStatement.findUnique({ where: { partnerId_periodStart: { partnerId, periodStart } } });
      }
      throw err;
    }
  }

  list(partnerId: string) {
    return this.prisma.partnerSettlementStatement.findMany({ where: { partnerId }, orderBy: { periodEnd: 'desc' }, take: 50 });
  }

  async get(statementId: string) {
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
   * due to TuTak (the live PARTNER_PAYABLE balance), and unconfirmed
   * external payments. Read-only; there is deliberately no withdraw.
   */
  async balanceSummary(partnerId: string) {
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { partnerId } });
    const raw = (type: LedgerAccountType) => accounts.find((a) => a.type === type)?.balance ?? new Decimal(0);
    const payable = raw(LedgerAccountType.PARTNER_PAYABLE);
    const pendingExternal = await this.prisma.partnerOrderPaymentLeg.aggregate({
      where: { type: 'EXTERNAL', status: 'PENDING', order: { partnerId, operationalStatus: { notIn: ['CANCELLED', 'EXPIRED', 'DRAFT'] } } },
      _sum: { amount: true },
    });
    return {
      partnerId,
      reservedInEscrow: raw(LedgerAccountType.PARTNER_ORDER_ESCROW).negated().toFixed(4),
      frozenForDisputes: raw(LedgerAccountType.PARTNER_DISPUTE_HOLD).negated().toFixed(4),
      dueToPartner: payable.isNegative() ? payable.negated().toFixed(4) : '0.0000',
      dueToTutak: payable.isPositive() ? payable.toFixed(4) : '0.0000',
      externalPaymentsAwaitingConfirmation: (pendingExternal._sum.amount ?? new Decimal(0)).toFixed(4),
      statements: await this.list(partnerId),
    };
  }

  /** Admin only (the controller enforces it): a partner's own settlement cadence. */
  async setPeriod(partnerId: string, period: SettlementPeriod, actorUserId: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundException('Partner not found');
    if (!Object.values(SettlementPeriod).includes(period)) throw new BadRequestException('Unknown settlement period');
    const updated = await this.prisma.partner.update({ where: { id: partnerId }, data: { settlementPeriod: period } });
    await this.auditService.record({
      actorUserId,
      action: AuditAction.PARTNER_SETTLEMENT_PERIOD_CHANGED,
      entityType: 'Partner',
      entityId: partnerId,
      metadata: { from: partner.settlementPeriod, to: period },
    });
    return { partnerId, settlementPeriod: updated.settlementPeriod };
  }
}
