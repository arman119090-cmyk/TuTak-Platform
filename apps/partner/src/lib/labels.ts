/**
 * Plain-English names for the codes the API hands out.
 *
 * The partner panel is English-only by decision (14.09.2026), but "English"
 * is not `status.toLowerCase()`: "outoforder" and "partner purchase" are
 * codes with the case knocked off, not words a cashier reads without
 * stopping. Every map falls back to the code itself so a value the map does
 * not know is still shown, never hidden.
 */

const TRANSACTION_TYPE: Record<string, string> = {
  QR_PAYMENT: 'QR payment',
  EV_CHARGING: 'EV charging',
  BONUS_ACCRUAL: 'Bonus earned',
  BONUS_REDEMPTION: 'Bonus spent',
  REFERRAL_REWARD: 'Referral reward',
  REFUND: 'Refund',
  MANUAL_ADJUSTMENT: 'Manual adjustment',
  PARTNER_PURCHASE: 'Purchase',
};

const TRANSACTION_STATUS: Record<string, string> = {
  INITIATED: 'Started',
  PENDING: 'In progress',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REVERSED: 'Reversed',
  FLAGGED: 'Under review',
};

const PAYOUT_STATUS: Record<string, string> = {
  REQUESTED: 'Requested — not sent yet',
  PAID: 'Paid',
  FAILED: 'Failed — still owed',
};

const CONNECTOR_STATUS: Record<string, string> = {
  AVAILABLE: 'Free',
  BLOCKED: 'Blocked',
  CHARGING: 'Charging',
  INOPERATIVE: 'Not working',
  OUTOFORDER: 'Out of order',
  PLANNED: 'Planned',
  REMOVED: 'Removed',
  RESERVED: 'Reserved',
  UNKNOWN: 'Status unknown',
};

const BRANCH_ROLE: Record<string, string> = {
  STAFF: 'Staff',
  MANAGER: 'Manager',
};

const label = (map: Record<string, string>) => (code: string) => map[code] ?? code;

export const transactionTypeLabel = label(TRANSACTION_TYPE);
export const transactionStatusLabel = label(TRANSACTION_STATUS);
export const payoutStatusLabel = label(PAYOUT_STATUS);
export const connectorStatusLabel = label(CONNECTOR_STATUS);
export const branchRoleLabel = label(BRANCH_ROLE);
