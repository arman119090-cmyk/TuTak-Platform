import {
  ContributionRuleKind,
  CustomerPaymentBlockReason,
  CustomerPaymentState,
  PaymentRoute,
  PurchaseIntentStatus,
  UnitOfMeasure,
} from '../enums/purchase-intent';
import type { PartnerBrandDto } from './media';

export interface CreatePurchaseIntentRequestDto {
  partnerId: string;
  partnerBranchId?: string;
  /** Full gross amount of the purchase — never the post-bonus remainder. */
  grossAmount: string;
  /** 0 up to the partner's max_bonus_payment_percent of grossAmount. */
  bonusAmountRequested?: string;
  /** Omit for the partner-direct route, which is the default. */
  paymentRoute?: PaymentRoute;
  /** All three together or none: a quantity with no unit price is a receipt
   *  nobody can re-derive. Required for a per-unit partner. */
  quantity?: string;
  quantityUnit?: UnitOfMeasure;
  unitPrice?: string;
}

/**
 * What a member of staff reads back to say they have seen what is being sold.
 *
 * Empty for a percentage partner — there is no line item to check, and
 * demanding one would train staff to type numbers they never looked at. For
 * `FIXED_PER_UNIT` and `HYBRID` all three are required and are compared
 * against the stored snapshot, which is what stops a customer who typed 500
 * litres getting past somebody who saw 50.
 */
export interface ApprovePurchaseIntentRequestDto {
  quantity?: string;
  quantityUnit?: UnitOfMeasure;
  unitPrice?: string;
  grossAmount?: string;
  note?: string;
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
  /** How the real-money remainder is collected. Fixed at creation. */
  paymentRoute: PaymentRoute;
  /** The line item, when the partner is paid per unit. Null otherwise. */
  quantity: string | null;
  quantityUnit: UnitOfMeasure | null;
  unitPrice: string | null;
  /**
   * The terms this purchase was priced under. Null for a partner who has no
   * rule row — those are still priced from `negotiatedRateBps`.
   */
  contributionRuleKind: ContributionRuleKind | null;
  contributionRuleVersion: number | null;
  /**
   * When somebody at the business agreed to the economics.
   *
   * On a `DIRECT_PARTNER` purchase the cashier's confirmation is this act.
   * On `TUTAK_PSP` it is a separate, earlier step: it authorises the bill and
   * nothing else, and the purchase is completed by the provider's verified
   * callback. Once set, the economics are frozen at the database level.
   */
  merchantApprovedAt: string | null;
  merchantApprovedByUserId: string | null;
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
  /** Who refused it. Null on purchases rejected before this was recorded. */
  rejectedByUserId: string | null;
  rejectionReason: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
}

/** What the customer's app may believe about their provider payment. */
export interface CustomerPaymentStatusDto {
  state: CustomerPaymentState;
  attemptId?: string;
  /** Where the purchase itself stands, so a closed one can be named as such. */
  purchaseStatus: PurchaseIntentStatus;
  /**
   * Whether the server would accept a begin call right now. The app offers
   * the pay button on this and nothing else — never on `state` alone.
   */
  canBeginPayment: boolean;
  /** Why not, when `canBeginPayment` is false. */
  reason: CustomerPaymentBlockReason | null;
}

/** What the client must do to let the customer pay at the provider. */
export type ProviderHandoffDto =
  | { type: 'REDIRECT'; url: string }
  | {
      type: 'FORM_POST';
      method: 'POST';
      action: string;
      /** Posted verbatim, in this order. Never re-derived by the client. */
      fields: Record<string, string>;
    };

export interface BeginPspPaymentResponseDto {
  attemptId: string;
  billId: string;
  handoff: ProviderHandoffDto;
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
