import { BonusEntryStatus, BonusEntryType, LedgerDirection } from '../enums/bonus';

/** Mirrors the Wallet row the API returns from GET /wallet/me. */
export interface WalletBalanceDto {
  id: string;
  userId: string;
  availableBonus: string;
  pendingBonus: string;
  reservedBonus: string;
  lifetimeEarned: string;
  lifetimeSpent: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors the BonusLedgerEntry row the API actually returns. */
export interface BonusLedgerEntryDto {
  id: string;
  walletId: string;
  type: BonusEntryType;
  direction: LedgerDirection;
  amount: string;
  balanceAfter: string;
  relatedLotId: string | null;
  relatedReservationId: string | null;
  sourceTransactionId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

/** A discrete batch of accrued points with its own expiry. */
export interface BonusLotDto {
  id: string;
  walletId: string;
  type: BonusEntryType;
  status: BonusEntryStatus;
  originalAmount: string;
  remainingAmount: string;
  sourceTransactionId: string | null;
  availableAt: string;
  expiresAt: string;
  createdAt: string;
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
