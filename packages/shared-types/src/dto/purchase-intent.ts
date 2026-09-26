import { PurchaseIntentStatus } from '../enums/purchase-intent';
import type { PartnerBrandDto } from './media';

export interface CreatePurchaseIntentRequestDto {
  partnerId: string;
  partnerBranchId?: string;
  /** Full gross amount of the purchase — never the post-bonus remainder. */
  grossAmount: string;
  /** 0 up to the partner's max_bonus_payment_percent of grossAmount. */
  bonusAmountRequested?: string;
  /**
   * Partner Commerce v2 (Q1 = C): paid from the customer's real TuTak money
   * balance — a separate source from the discount. The rest is external.
   */
  tutakMoneyAmount?: string;
}

export interface RejectPurchaseIntentRequestDto {
  reasonCode: string;
  comment?: string;
}

/** Mirrors the PurchaseIntent row the API returns. */
export interface PurchaseIntentDto {
  id: string;
  customerId: string;
  partnerId: string;
  partnerBranchId: string | null;
  status: PurchaseIntentStatus;
  grossAmount: string;
  bonusAmountRequested: string;
  /** Paid from the customer's TuTak money balance (0 for every pre-v2 purchase). */
  tutakMoneyAmount: string;
  /** The external part — paid to the partner directly: gross − bonus − tutakMoney. */
  ordinaryPaymentRemainder: string;
  negotiatedRateBps: number;
  maxBonusPaymentPercent: number;
  /**
   * The partner's brand as it was at the moment this intent was created —
   * spec §2.2. Snapshotted, not resolved live, so the QR purchase preview and
   * every later pending/confirmed/rejected/expired view of the same intent
   * agree with each other and with the transaction it becomes, even if the
   * partner replaces its logo in between.
   */
  partnerBrand: PartnerBrandDto;
  confirmedByUserId: string | null;
  /** The shift the confirming employee was on (spec §6.2); null for a shiftless rollout-window confirmation. */
  confirmedShiftId?: string | null;
  confirmedWithoutShift?: boolean;
  rejectionReason: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
}

/**
 * A QR refund's result (the partner app). COMMERCE_V2 purchases may come back
 * AWAITING_SHORTFALL_SETTLEMENT: the customer's already-spent allocation of
 * the purchase is netted from the money they get back, and whatever the
 * TuTak-money refund cannot cover is settled at the desk first (Q9) —
 * nothing has moved until an employee on shift confirms it.
 */
export interface PurchaseIntentRefundResultDto {
  refundId: string;
  status: 'COMPLETED' | 'AWAITING_SHORTFALL_SETTLEMENT' | 'MANUAL_REVIEW' | 'WITHDRAWN';
  amount: string;
  totalRefunded: string;
  bonusRestored: string;
  grossRefund: string;
  recoveredShortfall: string;
  netRefund: string;
  tutakMoneyRefunded: string;
  cashRefundNet: string;
  shortfallCollected: string;
}
