export enum PurchaseIntentStatus {
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  /** The customer withdrew the purchase before staff acted on it. */
  CANCELLED = 'CANCELLED',
}
