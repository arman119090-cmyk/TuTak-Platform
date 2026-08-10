/**
 * Lifecycle state of a bonus ledger entry.
 *
 * PENDING   — accrued but not yet clear for spend (e.g. cooling-off window after purchase).
 * AVAILABLE — clear and spendable.
 * RESERVED  — earmarked against an in-flight QR payment/EV session; cannot double-spend.
 * SETTLED   — reservation was consumed by a completed transaction.
 * EXPIRED   — passed its expiresAt without being spent.
 * REVERSED  — reversed by refund/fraud action; mirrored by a compensating ledger entry.
 */
export enum BonusEntryStatus {
  PENDING = 'PENDING',
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  SETTLED = 'SETTLED',
  EXPIRED = 'EXPIRED',
  REVERSED = 'REVERSED',
}

/**
 * What a bonus ledger entry records.
 *
 * The first eight change how many points the wallet holds. The last three do
 * not: they move points between the wallet's own buckets — pending,
 * available, reserved — and the total is the same before and after. Anything
 * presenting an entry to a person has to tell the two apart, or it reports a
 * transfer as a loss. `LedgerDirection.NEUTRAL` is how an entry says which
 * kind it is; see below.
 *
 * These three were in the database and in the API's responses, and missing
 * here, for as long as reservations have existed. A type that omits values
 * the server sends is worse than no type: it made a two-way branch over
 * `direction` look exhaustive, and the wallet screen printed a customer's
 * promoted points as a deduction.
 */
export enum BonusEntryType {
  ACCRUAL_PURCHASE = 'ACCRUAL_PURCHASE',
  ACCRUAL_REFERRAL = 'ACCRUAL_REFERRAL',
  ACCRUAL_PROMOTION = 'ACCRUAL_PROMOTION',
  ACCRUAL_MANUAL_ADJUSTMENT = 'ACCRUAL_MANUAL_ADJUSTMENT',
  REDEMPTION_QR_PAYMENT = 'REDEMPTION_QR_PAYMENT',
  REDEMPTION_EV_CHARGING = 'REDEMPTION_EV_CHARGING',
  EXPIRY = 'EXPIRY',
  REVERSAL = 'REVERSAL',

  /** Available → reserved, when a payment or charging session is started. */
  RESERVE_HOLD = 'RESERVE_HOLD',
  /** Reserved → available, when that payment or session did not complete. */
  RESERVE_RELEASE = 'RESERVE_RELEASE',
  /** Pending → available, when the cooling-off window on an accrual ends. */
  PENDING_PROMOTION = 'PENDING_PROMOTION',
}

/**
 * Which way an entry moved the wallet.
 *
 * CREDIT and DEBIT change the total. NEUTRAL does not — it marks the
 * bucket-to-bucket transfers above, where the same points are still there
 * under a different heading.
 *
 * Treat this as three-valued everywhere. `direction === 'CREDIT' ? gain :
 * loss` is the shape to look for: it is correct on two of the three and
 * silently wrong on the third.
 */
export enum LedgerDirection {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
  NEUTRAL = 'NEUTRAL',
}
