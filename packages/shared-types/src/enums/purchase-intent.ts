export enum PurchaseIntentStatus {
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  /** The customer withdrew the purchase before staff acted on it. */
  CANCELLED = 'CANCELLED',
}

/**
 * How the real-money part of a purchase is collected.
 *
 * Fixed when the purchase is created and never changed. One purchase, one
 * money route: a purchase collected at the till is never also collected
 * through the provider, and the database enforces that rather than the UI
 * merely not offering it.
 */
export enum PaymentRoute {
  /** The customer pays the partner directly — cash, or the partner's own card
   *  terminal. The route every purchase used before 15.09.2026. */
  DIRECT_PARTNER = 'DIRECT_PARTNER',
  /** The customer pays inside TuTak through a licensed provider, and TuTak
   *  then owes the partner the net amount. */
  TUTAK_PSP = 'TUTAK_PSP',
}

/**
 * How a partner's contribution to TuTak is priced on a given purchase.
 *
 * `FIXED_PER_UNIT` and `HYBRID` are why the cashier has to see and confirm
 * the quantity: the platform's own share is `quantity × margin`, so the
 * quantity is not a detail on the receipt, it is the price of the sale.
 */
export enum ContributionRuleKind {
  PERCENT_BPS = 'PERCENT_BPS',
  FIXED_PER_UNIT = 'FIXED_PER_UNIT',
  HYBRID = 'HYBRID',
}

/**
 * The units a per-unit term may be priced in.
 *
 * The financial identifier, never a label. Labels live in `@tutak/i18n`,
 * keyed by these values — "L" and "л" being different units would be a wrong
 * invoice, not a display problem.
 */
export enum UnitOfMeasure {
  LITER = 'LITER',
  KWH = 'KWH',
  KILOGRAM = 'KILOGRAM',
  ITEM = 'ITEM',
  HOUR = 'HOUR',
}

/**
 * What a customer may be told about their own provider payment.
 *
 * Every value is derived from the platform's own records. None of it comes
 * from where a browser redirect landed: a customer arriving at a success URL
 * proves a redirect was followed and nothing about money.
 */
export enum CustomerPaymentState {
  /** Not a provider-routed purchase at all. */
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  NOT_STARTED = 'NOT_STARTED',
  /** A bill is open and the provider has said nothing yet. */
  WAITING_PROVIDER = 'WAITING_PROVIDER',
  /** A verified confirmation is in hand; its effects are being applied. */
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  /** The provider said, authoritatively, that no money moved. */
  FAILED = 'FAILED',
  /**
   * The platform stopped waiting for the provider and nothing authoritative
   * has said whether the money moved. Not a decline: the customer must not
   * pay another way. A person will be asked if it stays unresolved.
   */
  UNRESOLVED = 'UNRESOLVED',
  /** Nobody can say yet. A human is looking. */
  REQUIRES_RECONCILIATION = 'REQUIRES_RECONCILIATION',
}

/**
 * Why the customer may not start a provider payment right now.
 *
 * Computed by the server from the same checks `beginAttempt` enforces, so
 * the app never has to guess — and never has to blame "the cashier has not
 * agreed" for a purchase that expired, a provider that is switched off, or
 * an earlier attempt that may already hold the money. `null` on the status
 * means the server would accept a begin call at this moment; it re-checks
 * on the call itself, so this is a preview, not a promise.
 */
export enum CustomerPaymentBlockReason {
  /** Paid at the till; the provider is not involved. */
  NOT_ROUTED = 'NOT_ROUTED',
  /** Provider payments are switched off on this deployment. */
  PROVIDER_DISABLED = 'PROVIDER_DISABLED',
  /** The purchase is no longer waiting: confirmed, refused, expired or cancelled. */
  PURCHASE_NOT_OPEN = 'PURCHASE_NOT_OPEN',
  /** Bonus covers the whole amount; there is no real money to collect. */
  NOTHING_TO_COLLECT = 'NOTHING_TO_COLLECT',
  /** Staff have not agreed the amount yet. */
  AWAITING_MERCHANT_APPROVAL = 'AWAITING_MERCHANT_APPROVAL',
  /** An earlier attempt may hold the money; a second one is refused. */
  UNRESOLVED_ATTEMPT = 'UNRESOLVED_ATTEMPT',
}

/**
 * What kind of event moved a purchase to `CONFIRMED`.
 *
 * Three things can do it and they are not interchangeable. Only
 * `PROVIDER_CALLBACK` is evidence that money reached TuTak; the other two say
 * the sale happened, and nothing about who holds the cash. A statement that
 * showed all three the same way would tell a partner they had been paid when
 * they had not.
 */
export enum PurchaseConfirmationSource {
  /** A person at a till, acting from their own authenticated session. */
  STAFF = 'STAFF',
  /** The partner's own POS or API integration, acting on its key. */
  PARTNER_INTEGRATION = 'PARTNER_INTEGRATION',
  /** A payment provider reporting that it collected the money. */
  PROVIDER_CALLBACK = 'PROVIDER_CALLBACK',
}
