import { BonusEntryStatus, BonusEntryType } from '../enums/bonus';

export interface WalletBalanceDto {
  userId: string;
  availableBonus: string;
  pendingBonus: string;
  reservedBonus: string;
  totalLifetimeEarned: string;
  totalLifetimeSpent: string;
  currency: 'BONUS_POINT';
  asOf: string;
}

export interface BonusLedgerEntryDto {
  id: string;
  walletId: string;
  type: BonusEntryType;
  status: BonusEntryStatus;
  amount: string;
  balanceAfter: string;
  sourceTransactionId: string | null;
  expiresAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ReserveBonusRequestDto {
  walletId: string;
  amount: string;
  reasonTransactionId: string;
  holdSeconds?: number;
}

export interface SettleBonusRequestDto {
  reservationId: string;
}

export interface ReleaseBonusRequestDto {
  reservationId: string;
  reason: string;
}
