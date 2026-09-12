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
  /**
   * The four digits the customer reads out at the till so a cashier can
   * find this purchase without scanning. A disambiguator, not a secret —
   * finding a purchase by it still needs staff authentication and the
   * partner/branch scope. Null on purchases created before codes existed.
   */
  confirmationCode: string | null;
  grossAmount: string;
  bonusAmountRequested: string;
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
  rejectionReason: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
}
