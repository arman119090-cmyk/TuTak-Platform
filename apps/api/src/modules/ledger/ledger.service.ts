import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Currency,
  LedgerAccountType,
  PostingDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * Serializable isolation does not queue conflicting transactions — it aborts
 * one and expects the application to try again. Without a retry, concurrent
 * postings to the same account fail outright, which a first draft of this
 * service did under a twenty-way concurrency test.
 *
 * 40001 is a serialization failure, 40P01 a deadlock. Both mean "your work
 * was fine, it just lost a race", and both are safe to repeat because `post`
 * is a pure function of its arguments.
 */
const RETRYABLE_CODES = new Set(['40001', '40P01']);
const MAX_ATTEMPTS = 5;

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  // Prisma wraps the driver error; the text is the only reliable signal.
  const message = err instanceof Error ? err.message : '';
  return /write conflict|deadlock|could not serialize/i.test(message);
}

async function withRetry<T>(operation: () => Promise<T>, logger: Logger): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastError = err;
      // Jittered backoff: without the jitter, contenders that collided once
      // wake together and collide again.
      const delay = Math.floor(2 ** attempt * 5 * (0.5 + Math.random()));
      await new Promise((resolve) => setTimeout(resolve, delay));
      logger.warn(`Ledger write conflict, attempt ${attempt} of ${MAX_ATTEMPTS}`);
    }
  }

  throw lastError;
}

/** One side of a financial event. The sign lives in `direction`. */
export interface PostingInput {
  accountId: string;
  direction: PostingDirection;
  amount: Decimal | number | string;
}

export interface PostParams {
  kind: string;
  /** The domain row that caused this, so accounting traces back to the event. */
  sourceType: string;
  sourceId: string;
  postings: PostingInput[];
  currency?: Currency;
  /** Written in the same transaction, so an event exists iff the money moved. */
  events?: Array<{
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }>;
}

/**
 * The double-entry ledger.
 *
 * One write path, on purpose. `post()` is the only way a posting is created,
 * and it does three things atomically: writes the transaction and its
 * postings, moves every affected account balance, and emits any outbox events.
 * All three or none.
 *
 * The balance rule is enforced by a deferred constraint trigger rather than
 * here, because a guard in application code protects only the callers that go
 * through it. This method checks the same rule first purely to produce a
 * readable error — the database is what makes it true.
 *
 * Balances are materialized on `LedgerAccount` for reads and are always
 * rewritten in the same transaction as the postings behind them, the same
 * discipline `Wallet` already follows. `assertLedgerIntegrity` in the test
 * suite proves the two agree after every operation.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Signed effect of a posting on its account, in the account's own terms. */
  private static signed(direction: PostingDirection, amount: Decimal): Decimal {
    return direction === PostingDirection.DEBIT ? amount : amount.negated();
  }

  /**
   * Moves every account's balance by its net delta from one transaction —
   * the shared tail of `post` and `reverse`, since a reversal is exactly the
   * same kind of balance move as the posting it undoes.
   *
   * `PARTNER_PAYABLE` accounts get one extra thing: this is also the single
   * place in the codebase that decides when `Partner.lastSettledAt` moves.
   * See that column's own docblock in schema.prisma for the full reasoning;
   * the short version is that every module which can change a partner's
   * payable balance — purchases, refunds, referral commissions, EV CDR
   * reconciliation, payouts, collections — reaches that balance only through
   * `post`/`reverse` (never a direct `ledgerAccount.update`, which is a
   * closed fact this codebase's own tests hold it to), so putting the
   * zero-crossing check here means no future balance-changing code path can
   * forget to keep the settlement clock honest. Reasoning from the balance
   * itself, not from "a payout was confirmed" or "a collection was
   * recorded", is exactly what closes the gap where a 1 AMD partial payment
   * used to buy a partner 14 days of silence on a much larger debt.
   *
   * Every account, `PARTNER_PAYABLE` included, still moves through the same
   * lock-free `SET balance = balance + delta` the concurrency test at the
   * bottom of this file relies on staying cheap — there is no separate
   * `SELECT ... FOR UPDATE` here, on purpose. Postgres's `UPDATE` already
   * returns the *new* balance for free, and this method already knows
   * `delta`, so `previous = updated - delta` falls out with no extra lock,
   * no extra round trip, and exactly the same row-lock lifetime the
   * increment-only version always had — a second posting to the same
   * account still simply waits for this statement's transaction to commit,
   * the same as before this pass. An earlier version of this method issued
   * its own `SELECT ... FOR UPDATE` first to get the previous balance, which
   * is real double-locking on top of what `UPDATE` itself already takes, and
   * a 20-way concurrency test against a single `PARTNER_PAYABLE` account
   * timed out waiting on Prisma's interactive-transaction pool as a direct
   * result — the arithmetic below is the fix, not a workaround.
   *
   * Processed in ascending account id order so that two transactions
   * touching the same two `PARTNER_PAYABLE` accounts can never deadlock by
   * acquiring their locks in opposite orders.
   */
  private async applyNetDeltas(client: Tx, net: Map<string, Decimal>): Promise<void> {
    const nonZero = [...net.entries()]
      .filter(([, delta]) => !delta.isZero())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (nonZero.length === 0) return;

    const accounts = await client.ledgerAccount.findMany({
      where: { id: { in: nonZero.map(([accountId]) => accountId) } },
      select: { id: true, type: true, partnerId: true },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    for (const [accountId, delta] of nonZero) {
      const updated = await client.ledgerAccount.update({
        where: { id: accountId },
        data: { balance: { increment: delta }, version: { increment: 1 } },
      });

      const meta = accountById.get(accountId);
      if (meta?.type !== LedgerAccountType.PARTNER_PAYABLE || !meta.partnerId) continue;

      const previous = updated.balance.minus(delta);
      if (previous.isZero() !== updated.balance.isZero()) {
        await client.partner.update({
          where: { id: meta.partnerId },
          data: { lastSettledAt: new Date() },
        });
      }
    }
  }

  async post(params: PostParams, tx?: Tx) {
    if (params.postings.length < 2) {
      // A single-sided posting is single-entry wearing a double-entry table.
      throw new BadRequestException('A ledger transaction needs at least two postings');
    }

    const currency = params.currency ?? Currency.AMD;
    const parsed = params.postings.map((posting, index) => ({
      ...posting,
      amount: parsePositiveMoney(posting.amount, `postings[${index}].amount`),
    }));

    const imbalance = parsed.reduce(
      (acc, p) => acc.plus(LedgerService.signed(p.direction, p.amount)),
      new Decimal(0),
    );
    if (!imbalance.isZero()) {
      throw new BadRequestException(
        `Ledger transaction does not balance: debits - credits = ${imbalance.toString()}`,
      );
    }

    const run = async (client: Tx) => {
      const transaction = await client.ledgerTransaction.create({
        data: {
          kind: params.kind,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
      });

      // Net per account first: a transaction that touches the same account
      // twice must move its balance once, by the sum.
      const net = new Map<string, Decimal>();
      for (const posting of parsed) {
        await client.ledgerPosting.create({
          data: {
            transactionId: transaction.id,
            accountId: posting.accountId,
            direction: posting.direction,
            amount: posting.amount,
            currency,
          },
        });
        const previous = net.get(posting.accountId) ?? new Decimal(0);
        net.set(
          posting.accountId,
          previous.plus(LedgerService.signed(posting.direction, posting.amount)),
        );
      }

      await this.applyNetDeltas(client, net);

      for (const event of params.events ?? []) {
        await client.outboxEvent.create({
          data: {
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            payload: event.payload as Prisma.InputJsonValue,
          },
        });
      }

      return transaction;
    };

    // Read Committed, deliberately, and not because Serializable was
    // inconvenient.
    //
    // Serializable protects against read-modify-write, and there is none here:
    // postings are inserts, which never conflict, and the balance move is
    // `SET balance = balance + delta` — a single atomic statement that
    // Postgres serialises through the row lock. Twenty concurrent postings
    // therefore produce the exact sum under Read Committed, which the
    // concurrency test proves, while Serializable aborted most of them for a
    // guarantee this code does not rely on.
    //
    // The retry stays for deadlocks, which are still possible when one
    // transaction touches several accounts in a different order from another.
    return tx
      ? run(tx)
      : withRetry(() => this.prisma.$transaction(run), this.logger);
  }

  /**
   * Reverses a transaction by posting its mirror image.
   *
   * Not an edit and not a delete — postings are immutable, and an accounting
   * record that can be rewritten is not a record. The unique index on
   * `reversesId` is what makes this safe under concurrency: a second attempt
   * to reverse the same transaction collides instead of double-crediting.
   */
  async reverse(transactionId: string, kind: string, tx?: Tx) {
    const run = async (client: Tx) => {
      const original = await client.ledgerTransaction.findUniqueOrThrow({
        where: { id: transactionId },
        include: { postings: true },
      });

      const reversal = await client.ledgerTransaction.create({
        data: {
          kind,
          sourceType: original.sourceType,
          sourceId: original.sourceId,
          reversesId: original.id,
        },
      });

      const net = new Map<string, Decimal>();
      for (const posting of original.postings) {
        const flipped =
          posting.direction === PostingDirection.DEBIT
            ? PostingDirection.CREDIT
            : PostingDirection.DEBIT;

        await client.ledgerPosting.create({
          data: {
            transactionId: reversal.id,
            accountId: posting.accountId,
            direction: flipped,
            amount: posting.amount,
            currency: posting.currency,
          },
        });

        const previous = net.get(posting.accountId) ?? new Decimal(0);
        net.set(posting.accountId, previous.plus(LedgerService.signed(flipped, posting.amount)));
      }

      await this.applyNetDeltas(client, net);

      return reversal;
    };

    return tx
      ? run(tx)
      : withRetry(() => this.prisma.$transaction(run), this.logger);
  }

  /**
   * Finds or creates an account. Concurrency-safe via the partial unique
   * indexes.
   *
   * `tx` is optional and defaults to the raw client, matching every existing
   * caller. Pass it when the caller's own enclosing transaction is
   * Serializable (or otherwise snapshot-isolated): without it, the
   * find/create round-trip runs on a separate connection outside that
   * transaction's snapshot, and a caller that then posts to the
   * just-created account inside the Serializable transaction hits a foreign
   * key violation — the account exists in the database but not yet in that
   * transaction's snapshot. READ COMMITTED callers (the default `post()`
   * path) never hit this, since each statement there re-snapshots.
   */
  async accountFor(
    params: {
      type: LedgerAccountType;
      userId?: string;
      partnerId?: string;
      currency?: Currency;
    },
    tx?: Tx,
  ) {
    const client = tx ?? this.prisma;
    const currency = params.currency ?? Currency.AMD;
    const where = {
      type: params.type,
      userId: params.userId ?? null,
      partnerId: params.partnerId ?? null,
      currency,
    };

    const existing = await client.ledgerAccount.findFirst({ where });
    if (existing) return existing;

    // `ON CONFLICT DO NOTHING`, so losing the race to a concurrent creator
    // costs a returned count of zero rather than a thrown unique violation.
    // The account either exists now because we made it or because someone
    // else did a millisecond earlier; both are the same account, and neither
    // is worth an ERROR in the log.
    await client.ledgerAccount.createMany({ data: [where], skipDuplicates: true });
    return client.ledgerAccount.findFirstOrThrow({ where });
  }

  /** Recomputes a balance from its postings. The reconciliation primitive. */
  async replayBalance(accountId: string): Promise<Decimal> {
    const postings = await this.prisma.ledgerPosting.findMany({
      where: { accountId },
      select: { direction: true, amount: true },
    });
    return postings.reduce(
      (acc, p) => acc.plus(LedgerService.signed(p.direction, p.amount)),
      new Decimal(0),
    );
  }
}
