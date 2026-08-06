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

export enum BonusEntryType {
  ACCRUAL_PURCHASE = 'ACCRUAL_PURCHASE',
  ACCRUAL_REFERRAL = 'ACCRUAL_REFERRAL',
  ACCRUAL_PROMOTION = 'ACCRUAL_PROMOTION',
  ACCRUAL_MANUAL_ADJUSTMENT = 'ACCRUAL_MANUAL_ADJUSTMENT',
  REDEMPTION_QR_PAYMENT = 'REDEMPTION_QR_PAYMENT',
  REDEMPTION_EV_CHARGING = 'REDEMPTION_EV_CHARGING',
  EXPIRY = 'EXPIRY',
  REVERSAL = 'REVERSAL',
}

/** Direction on the ledger's double-entry model. */
export enum LedgerDirection {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}
