import { Injectable } from '@nestjs/common';
import { JournalEntryType, LedgerAccountType, Prisma } from '@prisma/client';
import { assertEntryBalances, GLOBAL_ACCOUNT_KEY, JournalEntryInput } from '@cashout/contracts';
import { Money } from '@cashout/money';
import { PrismaService, TransactionClient, isUniqueViolation } from '../../prisma/prisma.service';
import { AppLogger } from '../../common/logging/logger.service';

export interface PostingSpec {
  readonly accountType: LedgerAccountType;
  readonly accountKey: string;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amount: Money;
}

export interface PostEntryInput {
  readonly type: JournalEntryType;
  /**
   * Business identity of the event, not of the request. Posting the same event
   * twice — a retried worker, a webhook delivered twice — must be a no-op, and
   * this key is what makes it one.
   */
  readonly idempotencyKey: string;
  readonly withdrawalId?: string;
  readonly description: string;
  readonly postings: readonly PostingSpec[];
  readonly metadata?: Prisma.InputJsonValue;
  readonly createdByAdminId?: string;
}

export interface AccountBalance {
  readonly accountType: LedgerAccountType;
  readonly accountKey: string;
  readonly currency: string;
  readonly balance: Money;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Posts one balanced journal entry.
   *
   * Three independent things have to agree before a row exists: this method's
   * own check, the unique index on the idempotency key, and the deferred
   * database trigger that re-sums the postings at commit. That redundancy is
   * deliberate — the ledger is the record that every other number in the product
   * is reconciled against.
   */
  async post(tx: TransactionClient, input: PostEntryInput): Promise<string | null> {
    assertEntryBalances(toContractEntry(input));

    let entryId: string;
    try {
      const entry = await tx.journalEntry.create({
        data: {
          type: input.type,
          idempotencyKey: input.idempotencyKey,
          withdrawalId: input.withdrawalId ?? null,
          description: input.description,
          metadata: input.metadata ?? Prisma.DbNull,
          createdByAdminId: input.createdByAdminId ?? null,
        },
        select: { id: true },
      });
      entryId = entry.id;
    } catch (error) {
      if (isUniqueViolation(error, 'idempotencyKey')) {
        this.logger.info('Journal entry already posted; skipping', {
          idempotencyKey: input.idempotencyKey,
          type: input.type,
        });
        return null;
      }
      throw error;
    }

    for (const posting of input.postings) {
      const account = await this.ensureAccount(
        tx,
        posting.accountType,
        posting.accountKey,
        posting.amount.currency,
      );
      await tx.ledgerPosting.create({
        data: {
          journalEntryId: entryId,
          accountId: account,
          direction: posting.direction,
          amountMinor: posting.amount.minor,
          currency: posting.amount.currency,
        },
      });
    }

    return entryId;
  }

  async ensureAccount(
    tx: TransactionClient,
    type: LedgerAccountType,
    key: string,
    currency: string,
  ): Promise<string> {
    const existing = await tx.ledgerAccount.findUnique({
      where: { type_key_currency: { type, key, currency } },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const created = await tx.ledgerAccount.create({
        data: { type, key, currency },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await tx.ledgerAccount.findUniqueOrThrow({
          where: { type_key_currency: { type, key, currency } },
          select: { id: true },
        });
        return raced.id;
      }
      throw error;
    }
  }

  /**
   * The account's balance in its own natural direction: a debit-normal account
   * reports debits minus credits, a credit-normal account the reverse, so that
   * every balance reads as a positive number when things are healthy.
   */
  async balanceOf(type: LedgerAccountType, key: string, currency: string): Promise<Money> {
    const rows = await this.prisma.$queryRaw<
      Array<{ debits: bigint | null; credits: bigint | null }>
    >`
      -- The ::bigint casts matter: Postgres sums bigints into numeric, which the
      -- driver hands back as a string, and a string subtraction would silently
      -- route a monetary value through an IEEE double.
      SELECT
        COALESCE(SUM(CASE WHEN p.direction = 'DEBIT'  THEN p."amountMinor" ELSE 0 END), 0)::bigint AS debits,
        COALESCE(SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountMinor" ELSE 0 END), 0)::bigint AS credits
      FROM ledger_postings p
      JOIN ledger_accounts a ON a.id = p."accountId"
      WHERE a.type = ${type}::"LedgerAccountType"
        AND a.key = ${key}
        AND a.currency = ${currency}
    `;
    const debits = rows[0]?.debits ?? 0n;
    const credits = rows[0]?.credits ?? 0n;
    const signed = NORMAL_DEBIT.has(type) ? debits - credits : credits - debits;
    return Money.fromMinor(signed, currency as never);
  }

  /**
   * The whole-ledger invariant: across every account and every currency, debits
   * equal credits. Run by the reconciliation job and exposed to the admin panel;
   * a non-zero result is a production incident, not a rounding difference.
   */
  async trialBalance(): Promise<Array<{ currency: string; difference: bigint }>> {
    return this.prisma.$queryRaw<Array<{ currency: string; difference: bigint }>>`
      SELECT currency,
             COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END), 0)::bigint AS difference
      FROM ledger_postings
      GROUP BY currency
    `;
  }

  async entriesForWithdrawal(withdrawalId: string) {
    return this.prisma.journalEntry.findMany({
      where: { withdrawalId },
      include: { postings: { include: { account: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }
}

const NORMAL_DEBIT = new Set<LedgerAccountType>([
  'PARK_RECEIVABLE',
  'PSP_SETTLEMENT',
  'PROVIDER_FEE_EXPENSE',
  'SUSPENSE',
]);

function toContractEntry(input: PostEntryInput): JournalEntryInput {
  return {
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    withdrawalId: input.withdrawalId,
    description: input.description,
    postings: input.postings.map((posting) => ({
      accountType: posting.accountType,
      accountKey: posting.accountKey || GLOBAL_ACCOUNT_KEY,
      direction: posting.direction,
      amountMinor: posting.amount.minor.toString(),
      currency: posting.amount.currency,
    })),
  };
}
