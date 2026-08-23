import type { PartnerBrandDto } from './media';
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
  /**
   * Who the points came from or went to, when that is a business — spec
   * §1.3's "wallet source rows when the source is a partner".
   *
   * Resolved through the entry's `sourceTransactionId`, so it is the snapshot
   * that transaction recorded, not the partner's brand as it stands today. Null
   * for every entry with no partner behind it: an expiry, a manual adjustment,
   * a referral reward.
   */
  partnerBrand: PartnerBrandDto | null;
  type: BonusEntryType;
  direction: LedgerDirection;
  /** Magnitude of the movement. Never negative; `direction` carries the sign. */
  amount: string;

  /**
   * Signed effect on each of the wallet's three buckets.
   *
   * The API has always sent these; this type did not declare them, so no
   * client could read them. That mattered: it is exactly the information the
   * wallet screen needed to describe a NEUTRAL entry, and without it the
   * screen had only `direction` to go on and got the sign wrong.
   *
   * The schema states the invariant these hold to:
   *
   *     availableDelta + pendingDelta + reservedDelta
   *       === +amount (CREDIT) | -amount (DEBIT) | 0 (NEUTRAL)
   */
  availableDelta: string;
  pendingDelta: string;
  reservedDelta: string;

  /** Total outstanding points — available + pending + reserved — afterwards. */
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
