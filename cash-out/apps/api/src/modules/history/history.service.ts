import { Injectable } from '@nestjs/common';
import type { JournalEntry, LedgerAccount, LedgerPosting, Withdrawal } from '@prisma/client';
import {
  HistoryEntryDetailDto,
  HistoryEntryDto,
  HistoryFilter,
  HistoryPageDto,
  toUserStatus,
} from '@cashout/contracts';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';

type EntryWithPostings = JournalEntry & {
  postings: Array<LedgerPosting & { account: LedgerAccount }>;
  withdrawal: Withdrawal | null;
};

/** The most rows one history read will merge before paginating. */
const SCAN_LIMIT = 2000;

/**
 * Balance history, read from what already exists.
 *
 * There is no second table of money facts. A line is either a withdrawal row
 * (including the ones still in flight, which the ledger does not know yet) or
 * a journal entry that touched the driver — a compensation, an operator's
 * adjustment. The two sources are merged, newest first, and paginated by a
 * cursor over (time, id). "Balance after" is stated only when Yandex reported
 * it for that operation; Cash Out does not compute a running balance it has
 * no authority over.
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  async list(driverId: string, filter: HistoryFilter): Promise<HistoryPageDto> {
    const range = {
      ...(filter.from ? { gte: new Date(filter.from) } : {}),
      ...(filter.to ? { lte: new Date(filter.to) } : {}),
    };
    const hasRange = Object.keys(range).length > 0;

    const [withdrawals, entries] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where: { driverId, ...(hasRange ? { createdAt: range } : {}) },
        orderBy: { createdAt: 'desc' },
        take: SCAN_LIMIT,
      }),
      this.prisma.journalEntry.findMany({
        where: {
          type: { in: ['COMPENSATION', 'ADJUSTMENT'] },
          ...(hasRange ? { createdAt: range } : {}),
          OR: [
            { withdrawal: { driverId } },
            { postings: { some: { account: { type: 'DRIVER_PAYABLE', key: driverId } } } },
          ],
        },
        include: { postings: { include: { account: true } }, withdrawal: true },
        orderBy: { createdAt: 'desc' },
        take: SCAN_LIMIT,
      }),
    ]);

    const parks = await this.parkNames([
      ...withdrawals.map((row) => row.parkId),
      ...entries.map((row) => row.withdrawal?.parkId).filter((id): id is string => !!id),
    ]);

    const all = [
      ...withdrawals.map((row) => this.fromWithdrawal(row, parks)),
      ...entries.map((row) => this.fromEntry(row, driverId, parks)),
    ]
      .filter((entry): entry is HistoryEntryDto => entry !== null)
      .filter((entry) => !filter.type || entry.type === filter.type)
      .filter((entry) => !filter.status || entry.status === filter.status)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

    const start = filter.cursor
      ? all.findIndex((entry) => cursorOf(entry) === filter.cursor) + 1
      : 0;
    const page = all.slice(start, start + filter.limit);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: last && start + filter.limit < all.length ? cursorOf(last) : null,
    };
  }

  async detail(driverId: string, id: string): Promise<HistoryEntryDetailDto> {
    const [kind, key] = id.split(':') as [string, string | undefined];
    if (!key) throw AppError.notFound('Operation');

    if (kind === 'w') {
      const withdrawal = await this.prisma.withdrawal.findFirst({ where: { id: key, driverId } });
      if (!withdrawal) throw AppError.notFound('Operation');
      const parks = await this.parkNames([withdrawal.parkId]);
      const [dto, timeline] = await Promise.all([
        this.withdrawals.toDto(withdrawal),
        this.withdrawals.timeline(driverId, withdrawal.id),
      ]);
      return {
        entry: this.fromWithdrawal(withdrawal, parks),
        withdrawal: dto,
        timeline,
        postings: [],
      };
    }

    if (kind === 'j') {
      const entry = await this.prisma.journalEntry.findUnique({
        where: { id: key },
        include: { postings: { include: { account: true } }, withdrawal: true },
      });
      const mapped = entry
        ? this.fromEntry(entry, driverId, await this.parkNames([entry.withdrawal?.parkId ?? '']))
        : null;
      if (!entry || !mapped) throw AppError.notFound('Operation');
      return {
        entry: mapped,
        withdrawal: entry.withdrawal ? await this.withdrawals.toDto(entry.withdrawal) : null,
        timeline: entry.withdrawal
          ? await this.withdrawals.timeline(driverId, entry.withdrawal.id)
          : [],
        postings: entry.postings.map((posting) => ({
          account: `${posting.account.type}:${posting.account.key}`,
          direction: posting.direction as 'DEBIT' | 'CREDIT',
          amount: Money.fromMinor(posting.amountMinor, posting.currency as CurrencyCode).toJSON(),
        })),
      };
    }

    throw AppError.notFound('Operation');
  }

  // ------------------------------------------------------------------ mapping

  private fromWithdrawal(row: Withdrawal, parks: Map<string, string>): HistoryEntryDto {
    const currency = row.currency as CurrencyCode;
    const status = toUserStatus(row.state);
    const comment =
      row.state === 'MANUAL_REVIEW' || row.state === 'RISK_REVIEW'
        ? 'under_review'
        : row.failureCode
          ? row.failureCode
          : null;
    return {
      id: `w:${row.id}`,
      operationId: row.reference,
      type: 'WITHDRAWAL',
      status,
      amount: Money.fromMinor(row.grossMinor, currency).negated().toJSON(),
      balanceAfter:
        row.yandexBalanceAfterMinor === null
          ? null
          : Money.fromMinor(row.yandexBalanceAfterMinor, currency).toJSON(),
      at: row.createdAt.toISOString(),
      comment,
      origin: row.origin === 'AUTO_PAYOUT' ? 'AUTO_PAYOUT' : 'DRIVER',
      withdrawalId: row.id,
      park: { id: row.parkId, name: parks.get(row.parkId) ?? '—' },
    };
  }

  private fromEntry(
    entry: EntryWithPostings,
    driverId: string,
    parks: Map<string, string>,
  ): HistoryEntryDto | null {
    const driverLeg = entry.postings.find(
      (posting) => posting.account.type === 'DRIVER_PAYABLE' && posting.account.key === driverId,
    );
    if (!driverLeg) return null;
    const currency = driverLeg.currency as CurrencyCode;

    if (entry.type === 'COMPENSATION' && entry.withdrawal) {
      // The gross debit going back onto the park balance.
      return {
        id: `j:${entry.id}`,
        operationId: entry.withdrawal.reference,
        type: 'REFUND',
        status: 'COMPLETED',
        amount: Money.fromMinor(entry.withdrawal.grossMinor, currency).toJSON(),
        balanceAfter: null,
        at: entry.createdAt.toISOString(),
        comment: (entry.metadata as { reason?: string } | null)?.reason ?? null,
        origin: 'SYSTEM',
        withdrawalId: entry.withdrawal.id,
        park: {
          id: entry.withdrawal.parkId,
          name: parks.get(entry.withdrawal.parkId) ?? '—',
        },
      };
    }

    if (entry.type === 'ADJUSTMENT') {
      // A credit to DRIVER_PAYABLE means Cash Out owes the driver more.
      const signed =
        driverLeg.direction === 'CREDIT'
          ? Money.fromMinor(driverLeg.amountMinor, currency)
          : Money.fromMinor(driverLeg.amountMinor, currency).negated();
      return {
        id: `j:${entry.id}`,
        operationId: entry.id.slice(0, 8).toUpperCase(),
        type: 'ADMIN_ADJUSTMENT',
        status: 'COMPLETED',
        amount: signed.toJSON(),
        balanceAfter: null,
        at: entry.createdAt.toISOString(),
        comment: (entry.metadata as { reason?: string } | null)?.reason ?? entry.description,
        origin: 'ADMIN',
        withdrawalId: entry.withdrawalId,
        park: null,
      };
    }

    return null;
  }

  private async parkNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.park.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

function cursorOf(entry: HistoryEntryDto): string {
  return `${entry.at}|${entry.id}`;
}
