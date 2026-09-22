import { TransactionStatus, TransactionType, Currency } from '../enums/transaction';
import type { PartnerBrandDto } from './media';

export interface TransactionDto {
  id: string;
  userId: string;
  partnerId: string | null;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: Currency;
  bonusAppliedAmount: string;
  bonusEarnedAmount: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  /**
   * Who the customer was dealing with, as this operation recorded it — spec
   * §1.3/§2.2. The immutable snapshot, never the partner's brand as it stands
   * today: a partner that rebrands must not rewrite last March's receipt.
   *
   * Null only when the transaction has no partner at all (a manual
   * adjustment, an expiry sweep). A partner transaction written before the
   * media system existed still gets a `partnerBrand` — with the partner's
   * current display name and a null logo — because the customer still needs
   * to know where they spent.
   */
  partnerBrand: PartnerBrandDto | null;
  /**
   * The purchase this row settled, when it is one — the id of the
   * `PurchaseIntent` whose `sourceTransactionId` is this transaction. Lets
   * the customer open the purchase itself: its route, what was refunded,
   * and the refunds behind that figure. Null for every row that is not a
   * purchase (bonus accruals, EV sessions, adjustments) and for purchases
   * written before intents existed.
   */
  purchaseIntentId: string | null;
  /**
   * Which branch of `partnerId` this operation happened at, or null.
   *
   * Null for three different reasons, and the reader cannot tell them apart
   * from here: the operation had no partner at all; it had one but recorded
   * no branch (a partner-wide QR, an EV session, roaming reconciliation —
   * see `Transaction.partnerBranchId`); or the branch row has since been
   * deleted, which sets the column null by `onDelete: SetNull`.
   *
   * Unlike `partnerBrand` above, this is **not** a snapshot. There is no
   * branch name stored on the transaction, so the name here is whatever the
   * branch is called today. A branch renamed last week renames itself in
   * every past row. That is a deliberate limitation of the current schema
   * and not a promise: a receipt-grade branch name would have to be written
   * onto the transaction the way `brandDisplayName` is.
   */
  branch: TransactionBranchDto | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A branch, as an operation row names it. Address as well as name, because
 * a chain commonly gives every shop the same name and the street is the only
 * thing that tells two of them apart.
 */
export interface TransactionBranchDto {
  id: string;
  name: string;
  address: string;
}

/** One refund recorded against a purchase — what the customer may see of it. */
export interface PurchaseIntentRefundDto {
  id: string;
  purchaseIntentId: string;
  /** Real money returned, 4dp. */
  amount: string;
  /** Bonus given back to the customer's wallet, 4dp. */
  bonusRestored: string;
  /** Stored money given back to the customer's balance, 4dp. */
  prepaidRestored: string;
  /** What the partner owes the customer back in cash/card, 4dp. `0` when nothing was paid at the till. */
  externalRefundDue: string;
  /**
   * Where the cash/card slice stands. A refund is complete for the customer
   * only when this is `NOT_REQUIRED` or `CONFIRMED`; `PENDING_PARTNER`
   * means the business has not yet said it handed the money back.
   */
  externalRefundStatus: 'NOT_REQUIRED' | 'PENDING_PARTNER' | 'CONFIRMED';
  externalRefundConfirmedAt: string | null;
  reason: string;
  createdAt: string;
}

/** A refund whose cash slice the business still has to hand back — the till's list. */
export interface PendingExternalRefundDto {
  id: string;
  purchaseIntentId: string;
  confirmationCode: string | null;
  purchaseGross: string;
  amount: string;
  bonusRestored: string;
  prepaidRestored: string;
  externalRefundDue: string;
  externalRefundStatus: 'PENDING_PARTNER';
  reason: string;
  createdAt: string;
}

export interface PaginatedResultDto<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}
