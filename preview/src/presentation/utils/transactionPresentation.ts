import { Ionicons } from '@expo/vector-icons';
import type { BonusState } from '@tutak/design';
import { formatPoints, formatSigned } from './format';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Presentation-only mapping from domain enums to visual language. Kept out
 * of the screens so an icon or tone is defined once and stays consistent
 * across Home, the transaction list and the wallet ledger.
 */
export function transactionIcon(type: string): IconName {
  switch (type) {
    case 'QR_PAYMENT':
      return 'qr-code-outline';
    case 'EV_CHARGING':
      return 'flash-outline';
    case 'BONUS_ACCRUAL':
      return 'add-circle-outline';
    case 'BONUS_REDEMPTION':
      return 'remove-circle-outline';
    case 'REFERRAL_REWARD':
      return 'gift-outline';
    case 'REFUND':
      return 'return-down-back-outline';
    case 'MANUAL_ADJUSTMENT':
      return 'construct-outline';
    default:
      return 'ellipse-outline';
  }
}

/** Money leaving the wallet is neutral; points arriving are positive. */
export function transactionTone(type: string): 'positive' | 'default' {
  return type === 'BONUS_ACCRUAL' || type === 'REFERRAL_REWARD' ? 'positive' : 'default';
}

/**
 * How to show one bonus ledger entry's amount.
 *
 * The bonus ledger has three directions, not two. CREDIT and DEBIT change how
 * many points the wallet holds. NEUTRAL does not: RESERVE_HOLD,
 * RESERVE_RELEASE and PENDING_PROMOTION move points between the wallet's own
 * buckets, and the total is identical either side of them.
 *
 * The wallet screen used to write `direction === 'CREDIT' ? +amount :
 * -amount`, which is right twice and wrong the third time. A customer who
 * earned 302.5 points saw, directly beneath the accrual, a line reading
 * −302.5 for the moment those same points became spendable. Nothing had been
 * taken from them. The two-way branch looked exhaustive because
 * `LedgerDirection` in shared-types was missing NEUTRAL — the type described
 * two of the three values the API sends.
 *
 * So a transfer is shown with no sign at all. It is a movement, and the
 * honest way to render a movement is the amount that moved.
 */
export function ledgerAmountFor(
  direction: string,
  amount: string,
): { value: string; tone: 'positive' | 'default' } {
  const n = Math.abs(Number(amount));
  if (direction === 'CREDIT') return { value: formatSigned(n), tone: 'positive' };
  if (direction === 'DEBIT') return { value: formatSigned(-n), tone: 'default' };
  return { value: formatPoints(n), tone: 'default' };
}

/** Maps a ledger entry / lot status onto one of the three brand states. */
export function bonusStateFor(status: string): BonusState {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'RESERVED':
      return 'reserved';
    default:
      return 'available';
  }
}

export function evStatusTone(status: string): BonusState {
  switch (status) {
    case 'AVAILABLE':
      return 'available';
    case 'CHARGING':
    case 'RESERVED':
      return 'reserved';
    default:
      return 'pending';
  }
}
