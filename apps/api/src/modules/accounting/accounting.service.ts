import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { csvDocument, csvRow } from './csv';

/**
 * Rows fetched per round trip while streaming an export.
 *
 * Small enough that one batch is never a memory problem, large enough that a
 * year of postings is not a million round trips.
 */
const EXPORT_BATCH = 1_000;

/** A period the caller asked for, already validated. */
export interface ExportPeriod {
  from: Date;
  /** Exclusive. See `parsePeriod` for why. */
  until: Date;
}

/**
 * Bookkeeping exports.
 *
 * ## Why this reads the ledger and nothing else
 *
 * An accountant's file has to agree with the books, and the books are
 * `ledger_postings`. Building a convenient rollup from `transactions` or
 * `purchase_intents` would produce a second set of numbers that is *nearly*
 * the ledger, and the day it disagrees is a day somebody has to work out
 * which one is the company's position. Every figure here is a posting or a
 * settlement row, exported as stored.
 *
 * Amounts leave as strings, at the scale they are stored. Formatting a
 * Decimal through a float to make it look tidy is how a rounding difference
 * gets into a tax return.
 */
@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Half-open `[from, until)`, and deliberately so.
   *
   * An inclusive end date is the classic source of double-counted or missing
   * days: "until 31 January" either includes every posting on the 31st or
   * none of them depending on whether a time component crept in, and the two
   * neighbouring monthly exports then overlap or leave a gap. Half-open
   * periods tile exactly.
   */
  parsePeriod(fromRaw: string, untilRaw: string): ExportPeriod {
    const from = new Date(fromRaw);
    const until = new Date(untilRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
      throw new BadRequestException('from and until must be ISO dates');
    }
    if (until <= from) {
      throw new BadRequestException('until must be after from');
    }
    return { from, until };
  }

  /**
   * Every posting in the period, one row each, with the account it moved and
   * the event that produced it.
   *
   * One row per posting rather than per transaction: a transaction has two or
   * more sides by construction, and collapsing it would lose exactly the
   * information double-entry exists to record. An accountant summing the
   * `debit` and `credit` columns of a whole period must get the same number
   * twice, and can only do that if both sides are present.
   */
  static readonly LEDGER_HEADER = [
    'posted_at',
    'transaction_id',
    'kind',
    'source_type',
    'source_id',
    'account_type',
    'partner_id',
    'user_id',
    'debit',
    'credit',
    'currency',
  ];

  /**
   * The ledger export, a batch at a time.
   *
   * ## Why this is not one `findMany`
   *
   * It was, and that was a defect I shipped. A year of postings is hundreds
   * of thousands of rows; loading them into one array and joining them into
   * one string holds the whole export in memory twice over, in a process
   * that is also serving customers. It never showed on test data, which is
   * exactly the shape of bug that reaches production — the code was written
   * as though the volume were always small, and nowhere said so.
   *
   * Keyset pagination on `id`, not `skip`/`take`: an offset walk re-reads
   * everything it has already passed, so the last page of a large export
   * costs the most, and rows inserted mid-walk shift the window and can
   * duplicate or drop a row. A cursor on a unique, ordered column has
   * neither problem.
   *
   * `id` is also the tiebreaker in the sort, which is what makes the order
   * total and the export byte-identical between two runs over unchanged data.
   */
  async *ledgerRows(period: ExportPeriod): AsyncGenerator<string> {
    yield csvRow(AccountingService.LEDGER_HEADER);

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.ledgerPosting.findMany({
        where: { transaction: { postedAt: { gte: period.from, lt: period.until } } },
        include: {
          transaction: { select: { kind: true, sourceType: true, sourceId: true, postedAt: true } },
          account: { select: { type: true, partnerId: true, userId: true, currency: true } },
        },
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) return;

      for (const p of batch) {
        yield csvRow([
          p.transaction.postedAt.toISOString(),
          p.transactionId,
          p.transaction.kind,
          p.transaction.sourceType,
          p.transaction.sourceId,
          p.account.type,
          p.account.partnerId,
          p.account.userId,
          p.direction === 'DEBIT' ? p.amount.toFixed(4) : '',
          p.direction === 'CREDIT' ? p.amount.toFixed(4) : '',
          p.currency,
        ]);
      }

      cursor = batch[batch.length - 1]!.id;
      if (batch.length < EXPORT_BATCH) return;
    }
  }

  /**
   * The whole ledger export as one string.
   *
   * Kept for tests and for callers that genuinely want the document in hand.
   * The HTTP route streams `ledgerRows` instead — see its note on memory.
   */
  async ledgerCsv(period: ExportPeriod): Promise<string> {
    const postings = await this.prisma.ledgerPosting.findMany({
      where: { transaction: { postedAt: { gte: period.from, lt: period.until } } },
      include: {
        transaction: { select: { kind: true, sourceType: true, sourceId: true, postedAt: true } },
        account: { select: { type: true, partnerId: true, userId: true, currency: true } },
      },
      // Same total order as the streaming path, so the two produce identical
      // files — asserted in the integration suite.
      orderBy: { id: 'asc' },
    });

    return csvDocument(
      AccountingService.LEDGER_HEADER,
      postings.map((p) => [
        p.transaction.postedAt.toISOString(),
        p.transactionId,
        p.transaction.kind,
        p.transaction.sourceType,
        p.transaction.sourceId,
        p.account.type,
        p.account.partnerId,
        p.account.userId,
        // Split into two columns rather than one signed column: that is the
        // shape every accounting package expects to import, and it removes
        // any argument about which sign means what.
        p.direction === 'DEBIT' ? p.amount.toFixed(4) : '',
        p.direction === 'CREDIT' ? p.amount.toFixed(4) : '',
        p.currency,
      ]),
    );
  }

  /**
   * Settlements whose money actually moved in the period.
   *
   * Filtered on `paidAt`, not on `createdAt` or the period the settlement
   * covers: what a bookkeeper reconciles against a bank statement is the
   * transfer, and the transfer happened when it happened. A settlement
   * drafted in January and paid in February belongs in February's bank
   * reconciliation, whatever period it was drafted for — both dates are in
   * the file so either view is available.
   */
  async settlementsCsv(period: ExportPeriod): Promise<string> {
    const settlements = await this.prisma.partnerSettlement.findMany({
      where: { paidAt: { gte: period.from, lt: period.until } },
      include: { partner: { select: { legalName: true, taxId: true } } },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    });

    return csvDocument(
      [
        'paid_at',
        'settlement_id',
        'partner_id',
        'partner_legal_name',
        'partner_tax_id',
        'period_start',
        'period_end',
        'accrued',
        'deductions',
        'net_paid',
        'currency',
        'bank_reference',
        'document_number',
      ],
      settlements.map((s) => [
        s.paidAt ? s.paidAt.toISOString() : '',
        s.id,
        s.partnerId,
        s.partner.legalName,
        s.partner.taxId,
        s.periodStart.toISOString().slice(0, 10),
        s.periodEnd.toISOString().slice(0, 10),
        s.accruedAmount.toFixed(4),
        s.deductionAmount.toFixed(4),
        s.netPayableAmount.toFixed(4),
        s.currency,
        s.bankTransferReference,
        s.documentNumber,
      ]),
    );
  }
}
