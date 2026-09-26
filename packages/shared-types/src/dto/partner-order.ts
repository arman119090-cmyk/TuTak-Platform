import {
  CancellationCostDecision,
  FinancialPolicyVersion,
  FulfillmentMethod,
  OrderDisputeStatus,
  OrderDisputeType,
  OrderEscalationType,
  PartnerOrderAdjustmentStatus,
  PartnerOrderAdjustmentType,
  PartnerOrderCancellationRequestStatus,
  PartnerOrderCancellationStatus,
  PartnerOrderCustomerStatus,
  PartnerOrderDisputeStatus,
  PartnerOrderOperationalStatus,
  PartnerOrderPaymentStatus,
  PartnerOrderReturnStatus,
  PartnerOrderSourcingStatus,
  PaymentLegStatus,
  PaymentLegType,
  SettlementPeriodicity,
  SourcingTaskStatus,
} from '../enums/partner-order';

export interface PartnerOrderItemDto {
  id: string;
  externalProductId: string | null;
  name: string;
  sku: string | null;
  oemNumber: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  imageUrl: string | null;
  description: string | null;
}

export interface PartnerOrderPaymentLegDto {
  id: string;
  type: PaymentLegType;
  purpose: 'ORDER' | 'ADDITIONAL';
  status: PaymentLegStatus;
  amount: string;
  refundedAmount: string;
  /** Item 8: kept by the partner as an admin-approved actual cancellation cost (real money only). */
  retainedAmount: string;
  confirmedAt: string | null;
  capturedAt: string | null;
  returnedAt: string | null;
  createdAt: string;
}

export interface PartnerOrderAdjustmentDto {
  id: string;
  orderId: string;
  type: PartnerOrderAdjustmentType;
  status: PartnerOrderAdjustmentStatus;
  previousTotalAmount: string;
  newTotalAmount: string;
  deltaAmount: string;
  description: string | null;
  details: { description?: string | null; differences?: string | null; sourceType?: string | null } | null;
  imageUrl: string | null;
  reason: string | null;
  createdAt: string;
  appliedAt: string | null;
}

/** Fields both the customer and the partner see. */
export interface PartnerOrderBaseDto {
  id: string;
  orderNumber: number;
  customerId: string | null;
  partnerId: string;
  branchId: string | null;
  externalOrderId: string;
  serviceType: string | null;
  category: string | null;
  currency: string;
  subtotal: string;
  totalAmount: string;
  discountAmount: string;
  tutakMoneyAmount: string;
  externalAmount: string;
  prepaymentRequiredAmount: string;
  /** Q13: what actually secured the prepayment — TuTak money only, never the discount. */
  prepaymentCoveredAmount: string;
  refundedAmount: string;
  financialPolicyVersion: FinancialPolicyVersion;
  cancellationTerms: string | null;
  cancellationStatus: PartnerOrderCancellationStatus;
  fulfillmentMethod: FulfillmentMethod | null;
  courierNote: string | null;
  operationalStatus: PartnerOrderOperationalStatus;
  paymentStatus: PartnerOrderPaymentStatus;
  sourcingStatus: PartnerOrderSourcingStatus;
  disputeStatus: PartnerOrderDisputeStatus;
  sourcingAllowed: boolean;
  createdAt: string;
  draftExpiresAt: string;
  submittedAt: string | null;
  partnerSeenAt: string | null;
  stockConfirmedAt: string | null;
  stockRejectedAt: string | null;
  outForDeliveryAt: string | null;
  readyForPickupAt: string | null;
  deliveredAt: string | null;
  customerReceivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  items: PartnerOrderItemDto[];
  paymentLegs: PartnerOrderPaymentLegDto[];
  adjustments: PartnerOrderAdjustmentDto[];
  cancellations?: PartnerOrderCancellationDto[];
  returns?: PartnerOrderReturnDto[];
}

/** What a customer sees (the API strips commission, staff identities, SLA state). */
export interface CustomerPartnerOrderDto extends PartnerOrderBaseDto {
  customerStatus: PartnerOrderCustomerStatus;
  canConfirmReceipt: boolean;
  canCancel: boolean;
  canWithdrawCancellation: boolean;
  canOpenDispute: boolean;
}

/** Item 8: a cancellation request and, if any, the partner's actual-cost claim and TuTak's decision. */
export interface PartnerOrderCancellationDto {
  id: string;
  orderId: string;
  status: PartnerOrderCancellationRequestStatus;
  reason: string | null;
  partnerDeadlineAt: string;
  claimedCostAmount: string | null;
  costReason: string | null;
  costEvidence: string | null;
  costEvidenceUrls: string[];
  claimedAt: string | null;
  decision: CancellationCostDecision | null;
  approvedCostAmount: string;
  costFromExternal: string;
  costFromMoney: string;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  order?: PartnerOrderDto & {
    partner?: { id: string; displayName: string };
    customer?: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null;
  };
}

/**
 * A return, with the Q9 breakdown kept as separate figures: `grossRefund`
 * (money owed back), `recoveredShortfall` (the customer's already-spent
 * allocation, recovered from it or at the desk), `netRefund` (what they get).
 */
export interface PartnerOrderReturnDto {
  id: string;
  orderId: string;
  amount: string;
  reason: string;
  status: PartnerOrderReturnStatus;
  discountRestored: string;
  tutakMoneyGross: string;
  tutakMoneyRefunded: string;
  externalRefundGross: string;
  externalRefundDue: string;
  grossRefund: string;
  recoveredShortfall: string;
  netRefund: string;
  shortfallAmount: string;
  shortfallFromMoney: string;
  shortfallFromExternal: string;
  shortfallCollected: string;
  poolReversed?: string;
  referralWithheld?: string;
  manualReviewReason: string | null;
  refusalNote: string | null;
  reviewNote: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OrderDisputeCommentDto {
  id: string;
  authorUserId: string;
  authorType: 'CUSTOMER' | 'PARTNER' | 'ADMIN' | 'SYSTEM';
  body: string;
  attachmentUrls: string[];
  createdAt: string;
}

export interface OrderDisputeDto {
  id: string;
  orderId: string;
  type: OrderDisputeType;
  status: OrderDisputeStatus;
  reason: string;
  description: string | null;
  openedByType: 'CUSTOMER' | 'PARTNER' | 'ADMIN' | 'SYSTEM';
  disputedAmount: string;
  openedAfterSettlement: boolean;
  frozenAmount: string;
  customerRefundAmount: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  comments?: OrderDisputeCommentDto[];
  order?: PartnerOrderDto & {
    partner?: { id: string; displayName: string };
    customer?: { id: string; firstName: string | null; lastName: string | null; phone: string | null };
  };
}

/** Partner/admin view: also carries the commission snapshot. */
export interface PartnerOrderDto extends PartnerOrderBaseDto {
  commissionRateBps: number;
  commissionAmount: string;
  poolAmount: string | null;
  manualReviewAt?: string | null;
  manualReviewReason?: string | null;
  paymentIssueAt?: string | null;
  returns?: PartnerOrderReturnDto[];
  disputes?: OrderDisputeDto[];
}

export interface AdminPartnerOrderDto extends PartnerOrderDto {
  partner: { id: string; displayName: string; legalName: string };
  branch: { id: string; name: string; address: string } | null;
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null;
  escalations: OrderEscalationDto[];
}

export interface PartnerOrderCheckoutDto {
  order: CustomerPartnerOrderDto;
  partner: { id: string; displayName: string };
  balances: { discountAvailable: string; tutakMoney: string };
  limits: {
    maxDiscountAmount: string;
    prepaymentRequiredAmount: string;
    /** Q13: only the TuTak-money part counts toward the prepayment — never the discount. */
    prepaymentCountsFrom: 'TUTAK_MONEY';
  };
  /** Item 8: the partner's disclosed cancellation-cost terms, shown before "Подтвердить заказ". */
  cancellationTerms: string | null;
}

export interface ClaimCancellationCostRequestDto {
  amount: string;
  reason: string;
  evidence?: string;
  evidenceUrls?: string[];
}

export interface DecideCancellationCostRequestDto {
  decision: 'APPROVE' | 'REDUCE' | 'REJECT';
  approvedAmount?: string;
  note: string;
}

export interface ReviewShortfallRequestDto {
  decision: 'WITHDRAW' | 'REOPEN';
  note: string;
}

/** Q8: a USER referrer's spent referral share of a returned purchase, repaid by future accruals. */
export interface ReferralWithholdingDto {
  id: string;
  userId: string;
  level: number;
  amount: string;
  remainingAmount: string;
  status: 'OPEN' | 'SETTLED';
  beneficiaryPartnerId: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  settledAt: string | null;
  recoveries?: { id: string; amount: string; bonusLotId: string; createdAt: string }[];
}

export interface SubmitPartnerOrderRequestDto {
  discountAmount?: string;
  tutakMoneyAmount?: string;
  idempotencyKey: string;
}

export interface AcceptAdjustmentRequestDto {
  discountAmount?: string;
  tutakMoneyAmount?: string;
  idempotencyKey?: string;
}

export interface RejectStockRequestDto {
  reason?: string;
}

export interface SourcingTaskDto {
  id: string;
  orderId: string;
  status: SourcingTaskStatus;
  assignedToUserId: string | null;
  claimedAt: string | null;
  resultProductName: string | null;
  resultDescription: string | null;
  resultImageUrl: string | null;
  resultPrice: string | null;
  resultNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  order?: PartnerOrderDto & {
    partner?: { id: string; displayName: string };
    customer?: { id: string; firstName: string | null; lastName: string | null } | null;
  };
}

export interface RecordSourcingResultRequestDto {
  status: 'FOUND_EXACT' | 'FOUND_ALTERNATE' | 'NOT_FOUND';
  sourceType?: 'OTHER_TUTAK_PARTNER' | 'EXTERNAL';
  sourcePartnerId?: string;
  productName?: string;
  description?: string;
  differences?: string;
  imageUrl?: string;
  price?: string;
  notes?: string;
}

export interface OrderEscalationDto {
  id: string;
  orderId: string;
  type: OrderEscalationType;
  createdAt: string;
  claimedByUserId: string | null;
  claimedAt: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  order?: PartnerOrderDto & {
    partner?: { id: string; displayName: string; legalName: string };
    branch?: { id: string; name: string; address: string } | null;
  };
}

export interface CommissionRuleDto {
  id: string;
  partnerId: string;
  serviceType: string | null;
  category: string | null;
  name: string;
  rateBps: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateCommissionRuleRequestDto {
  partnerId: string;
  serviceType?: string;
  category?: string;
  name: string;
  rateBps: number;
}

export interface PrepaymentRuleDto {
  id: string;
  partnerId: string;
  serviceType: string | null;
  category: string | null;
  mode: 'PERCENT' | 'FIXED';
  percentBps: number | null;
  fixedAmount: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreatePrepaymentRuleRequestDto {
  partnerId: string;
  serviceType?: string;
  category?: string;
  mode: 'PERCENT' | 'FIXED';
  percentBps?: number;
  fixedAmount?: string;
}

export interface EmployeeShiftDto {
  id: string;
  partnerId: string;
  branchId: string;
  userId: string;
  businessDate: string;
  startedAt: string;
  endedAt: string | null;
  endReason: 'MANUAL' | 'NEW_BUSINESS_DAY' | 'DEACTIVATED' | null;
}

export interface MyShiftDto {
  shift: EmployeeShiftDto | null;
  shiftsRequiredFrom: string | null;
  shiftsRequiredNow: boolean | null;
}

/**
 * A settlement statement is a *report* over the one settlement engine
 * (PartnerSettlement / PartnerSettlementEntry): every PARTNER_PAYABLE and
 * dispute-hold posting of a period of the partner's cadence, with the
 * settlement that claimed it — or why nothing will pay it.
 */
export type PartnerStatementLineClassification = 'SETTLEABLE' | 'TRANSFER' | 'NOT_SETTLEABLE';

export interface PartnerSettlementStatementLineDto {
  postingId: string;
  postedAt: string;
  account: 'PARTNER_PAYABLE' | 'PARTNER_DISPUTE_HOLD';
  kind: string;
  sourceType: string;
  sourceId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  /** + owed to the partner, − owed to TuTak. */
  owedToPartner: string;
  classification: PartnerStatementLineClassification;
  settlementId: string | null;
  settlementStatus: string | null;
}

export interface PartnerSettlementStatementDto {
  partnerId: string;
  periodicity: SettlementPeriodicity;
  anchorDay: number;
  periodStart: string;
  periodEnd: string;
  openingOwedToPartner: string;
  closingOwedToPartner: string;
  totals: {
    accrued: string;
    deducted: string;
    settleableNet: string;
    claimedBySettlements: string;
    transfers: string;
    notSettleable: string;
    frozenForDisputes: string;
  };
  unrecognisedKinds: string[];
  settlements: { id: string; status: string; periodStart: string; periodEnd: string; netPayableAmount: string; paidAt: string | null }[];
  /** Present on a single period's statement, omitted in the list. */
  lines?: PartnerSettlementStatementLineDto[];
}

export interface PartnerBalanceSummaryDto {
  partnerId: string;
  settlementPeriodicity: SettlementPeriodicity;
  settlementAnchorDay: number;
  reservedInEscrow: string;
  reservedMoneyInEscrow: string;
  reservedDiscountInEscrow: string;
  /** Q8: commission refunds owed to this partner, repaid as referrers' future accruals come in. */
  commissionRefundAwaitingWithholding: string;
  frozenForDisputes: string;
  dueToPartner: string;
  dueToTutak: string;
  /** What the settlement engine would claim now. */
  unsettledNet: string;
  unrecognisedKinds: string[];
  externalPaymentsAwaitingConfirmation: string;
  statements: PartnerSettlementStatementDto[];
}
