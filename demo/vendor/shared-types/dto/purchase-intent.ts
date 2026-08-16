import { PurchaseIntentStatus } from '../enums/purchase-intent';

export interface CreatePurchaseIntentRequestDto {
  partnerId: string;
  partnerBranchId?: string;
  /** Full gross amount of the purchase — never the post-bonus remainder. */
  grossAmount: string;
  /** 0 up to the partner's max_bonus_payment_percent of grossAmount. */
  bonusAmountRequested?: string;
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
  ordinaryPaymentRemainder: string;
  negotiatedRateBps: number;
  maxBonusPaymentPercent: number;
  confirmedByUserId: string | null;
  rejectionReason: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
}
