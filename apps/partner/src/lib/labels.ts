/**
 * Readable names for the codes the API hands out.
 *
 * "Readable" is not `status.toLowerCase()`: "outoforder" and "partner
 * purchase" are codes with the case knocked off, not words a cashier reads
 * without stopping. Every map falls back to the code itself so a value the
 * map does not know is still shown, never hidden.
 *
 * The screens already translated read a key instead of a finished string —
 * `transactionTypeKey` and friends below — so the word follows the panel's
 * language. The maps that remain belong to screens still on the English
 * backlog; they keep their finished strings until those screens are done,
 * because a half-translated screen is harder to read than an English one.
 */

/** `partnerPanel.transactionType.QR_PAYMENT` — for a screen with `t()`. */
export const transactionTypeKey = (code: string) => `partnerPanel.transactionType.${code}`;
/** `partnerPanel.transactionStatus.COMPLETED` — for a screen with `t()`. */
export const transactionStatusKey = (code: string) => `partnerPanel.transactionStatus.${code}`;

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

export const payoutStatusLabel = label(PAYOUT_STATUS);
export const connectorStatusLabel = label(CONNECTOR_STATUS);
export const branchRoleLabel = label(BRANCH_ROLE);
