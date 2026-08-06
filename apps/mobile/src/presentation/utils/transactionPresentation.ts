import { Ionicons } from '@expo/vector-icons';
import type { BonusState } from '@tutak/design';

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
