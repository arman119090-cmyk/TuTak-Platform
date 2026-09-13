import { PurchaseIntentStatus } from '../enums/purchase-intent';
import type { PartnerBrandDto } from './media';

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
  /**
   * How much of this purchase's merchandise value has already been returned.
   * `0` for a sale nobody has refunded. Exposed so a dashboard can show what
   * is still returnable without asking for the refund list of every row it
   * draws.
   */
  refundedAmount: string;
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
  rejectionReason: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
}

/**
 * Whether a refund somebody asked for has been decided yet — the maker/
 * checker split the owner chose on 2026-09-12. `PENDING` has no financial
 * effect whatsoever; only `APPROVED` has ever touched the ledger.
 */
export enum RefundRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** A refund a member of staff asked for, as the dashboard sees it. */
export interface PurchaseIntentRefundRequestDto {
  id: string;
  purchaseIntentId: string;
  partnerId: string;
  partnerBranchId: string | null;
  /** Null means "whatever is still refundable", resolved at approval. */
  amount: string | null;
  reason: string;
  status: RefundRequestStatus;
  requestedByUserId: string;
  requestedAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The refund this became, once approved. */
  refundId: string | null;
}

/** What a cashier sends when a customer brings something back. */
export interface CreateRefundRequestRequestDto {
  amount?: string;
  reason: string;
}

/** What an owner or manager sends when turning one down. */
export interface RejectRefundRequestRequestDto {
  note?: string;
}
