/**
 * The chart of accounts and the journal vocabulary.
 *
 * Cash Out keeps a full double-entry ledger. Nothing in the system is allowed to
 * state a monetary fact except by posting a balanced journal entry, and journal
 * entries are append-only: a mistake is corrected by posting its inverse, never
 * by editing or deleting a row. That is what makes "where did this money go"
 * answerable months later, and what lets reconciliation prove — rather than
 * assume — that the two external systems agree with our books.
 */

export const LEDGER_ACCOUNT_TYPES = [
  /**
   * What the park owes Cash Out for balances we have already debited on its
   * behalf inside Yandex. Asset.
   */
  'PARK_RECEIVABLE',
  /** What Cash Out owes a driver but has not yet paid out. Liability. */
  'DRIVER_PAYABLE',
  /** Cash Out's money sitting at the payment provider, ready to be sent. Asset. */
  'PSP_SETTLEMENT',
  /** Cash Out's commission, recognised when the withdrawal is reserved. Income. */
  'PLATFORM_FEE_REVENUE',
  /** The provider fee collected from the driver. Income. */
  'PROVIDER_FEE_REVENUE',
  /** What the provider actually charges us for the transfer. Expense. */
  'PROVIDER_FEE_EXPENSE',
  /**
   * Where a known-unknown parks until it is resolved: money we believe moved but
   * cannot yet attribute. A non-zero suspense balance is an operational alarm,
   * not an accounting nicety.
   */
  'SUSPENSE',
] as const;

export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export type NormalBalance = 'DEBIT' | 'CREDIT';

export const NORMAL_BALANCE: Readonly<Record<LedgerAccountType, NormalBalance>> = {
  PARK_RECEIVABLE: 'DEBIT',
  DRIVER_PAYABLE: 'CREDIT',
  PSP_SETTLEMENT: 'DEBIT',
  PLATFORM_FEE_REVENUE: 'CREDIT',
  PROVIDER_FEE_REVENUE: 'CREDIT',
  PROVIDER_FEE_EXPENSE: 'DEBIT',
  SUSPENSE: 'DEBIT',
};

export const JOURNAL_ENTRY_TYPES = [
  /** The Yandex debit landed: the park now owes us, and we now owe the driver. */
  'WITHDRAWAL_RESERVE',
  /** Cash Out's and the provider's commissions are taken out of what we owe the driver. */
  'FEE_CAPTURE',
  /** The payout settled: our PSP balance went down, our debt to the driver is discharged. */
  'PAYOUT_SETTLEMENT',
  /** What the provider charged us for moving the money. */
  'PROVIDER_COST',
  /** The inverse of an earlier entry, posted when a payout failed or was returned. */
  'COMPENSATION',
  /** A deliberate manual correction, always attributed to an operator. */
  'ADJUSTMENT',
] as const;

export type JournalEntryType = (typeof JOURNAL_ENTRY_TYPES)[number];

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface LedgerPostingInput {
  readonly accountType: LedgerAccountType;
  /**
   * Which concrete account of that type: a driver id, a park id, a provider
   * account id. Global accounts (revenue, expense) use a fixed key.
   */
  readonly accountKey: string;
  readonly direction: LedgerDirection;
  /** Non-negative integer minor units, as a string. */
  readonly amountMinor: string;
  readonly currency: string;
}

export interface JournalEntryInput {
  readonly type: JournalEntryType;
  /** Business key that makes posting idempotent — usually `${withdrawalId}:${type}`. */
  readonly idempotencyKey: string;
  readonly withdrawalId?: string;
  readonly description: string;
  readonly postings: readonly LedgerPostingInput[];
  readonly metadata?: Record<string, unknown>;
}

export class UnbalancedJournalEntryError extends Error {
  constructor(
    readonly currency: string,
    readonly debitMinor: bigint,
    readonly creditMinor: bigint,
  ) {
    super(
      `Journal entry does not balance in ${currency}: debits ${debitMinor} != credits ${creditMinor}`,
    );
    this.name = 'UnbalancedJournalEntryError';
  }
}

/**
 * Rejects an entry that does not balance, per currency, before it can reach the
 * database. The database enforces the same rule again with a trigger — a ledger
 * that can be corrupted by one forgotten code path is not a ledger.
 */
export function assertEntryBalances(entry: JournalEntryInput): void {
  if (entry.postings.length < 2) {
    throw new UnbalancedJournalEntryError('n/a', 0n, 0n);
  }
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const posting of entry.postings) {
    const amount = BigInt(posting.amountMinor);
    if (amount < 0n) {
      throw new RangeError(
        `Posting amounts must be non-negative; use the direction to express sign (got ${posting.amountMinor})`,
      );
    }
    const bucket = totals.get(posting.currency) ?? { debit: 0n, credit: 0n };
    if (posting.direction === 'DEBIT') {
      bucket.debit += amount;
    } else {
      bucket.credit += amount;
    }
    totals.set(posting.currency, bucket);
  }
  for (const [currency, { debit, credit }] of totals) {
    if (debit !== credit) {
      throw new UnbalancedJournalEntryError(currency, debit, credit);
    }
  }
}

/** Global (non-per-entity) accounts use this key. */
export const GLOBAL_ACCOUNT_KEY = 'GLOBAL';
