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
  createdAt: string;
  updatedAt: string;
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
