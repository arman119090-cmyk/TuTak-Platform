/**
 * Settlement vocabulary, shared so that the dashboards and the API cannot
 * drift apart about what a settlement *is*.
 *
 * These mirror the Prisma enums of the same names. Kept in step by hand, as
 * every other enum in this package is — the alternative, generating them,
 * would drag a Prisma dependency into a package the mobile app imports.
 */

/** Where a settlement sits between "being assembled" and "paid". */
export enum PartnerSettlementStatus {
  /** Entries are claimed so nothing else can take them, but no money is promised. */
  DRAFT = 'DRAFT',
  /** Figures final, document attached. Awaiting a second person's approval. */
  READY = 'READY',
  /** A second admin approved it — the checker half of maker/checker. */
  APPROVED = 'APPROVED',
  /** Transfer initiated by hand; nothing is posted to the ledger yet. */
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  /** The transfer landed. The only status that posts, and immutable after. */
  PAID = 'PAID',
  /**
   * A transfer was rejected or returned. **Not terminal, and not a loss.**
   * The entries stay claimed and another transfer may be made against the
   * same figure: a bank refusing one transfer does not change what is owed.
   */
  FAILED = 'FAILED',
  /** The bank's answer is ambiguous. Never retried automatically. */
  REQUIRES_RECONCILIATION = 'REQUIRES_RECONCILIATION',
  /** Abandoned before payment; releases its entries back to unsettled. */
  CANCELLED = 'CANCELLED',
}

/** Who raised the question of whether a transfer actually happened. */
export enum ReconciliationSource {
  FINANCE = 'FINANCE',
  /** A partner may report a problem; they may never decide the answer. */
  PARTNER_REPORT = 'PARTNER_REPORT',
}

/** What two people concluded about a transfer nobody could account for. */
export enum ReconciliationOutcome {
  MONEY_MOVED = 'MONEY_MOVED',
  MONEY_DID_NOT_MOVE = 'MONEY_DID_NOT_MOVE',
}
