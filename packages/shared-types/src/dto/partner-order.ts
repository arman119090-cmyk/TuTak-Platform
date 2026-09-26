import {
  OrderDisputeStatus,
  OrderDisputeType,
  OrderEscalationType,
  PartnerOrderAdjustmentStatus,
  PartnerOrderAdjustmentType,
  PartnerOrderCustomerStatus,
  PartnerOrderDisputeStatus,
  PartnerOrderOperationalStatus,
  PartnerOrderPaymentStatus,
  PartnerOrderReturnStatus,
  PartnerOrderSourcingStatus,
  PaymentLegStatus,
  PaymentLegType,
  SettlementPeriod,
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
  refundedAmount: string;
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
  handedOverAt: string | null;
  customerReceivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  items: PartnerOrderItemDto[];
  paymentLegs: PartnerOrderPaymentLegDto[];
  adjustments: PartnerOrderAdjustmentDto[];
}

/** What a customer sees (the API strips commission, staff identities, SLA state). */
export interface CustomerPartnerOrderDto extends PartnerOrderBaseDto {
  customerStatus: PartnerOrderCustomerStatus;
  canConfirmReceipt: boolean;
  canCancel: boolean;
  canOpenDispute: boolean;
}

export interface PartnerOrderReturnDto {
  id: string;
  orderId: string;
  amount: string;
  reason: string;
  status: PartnerOrderReturnStatus;
  discountRestored: string;
  tutakMoneyRefunded: string;
  externalRefundDue: string;
  poolReversed: string;
  shortfallAmount: string;
  manualReviewReason: string | null;
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
  limits: { maxDiscountAmount: string; prepaymentRequiredAmount: string };
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

export interface PartnerSettlementStatementDto {
  id: string;
  partnerId: string;
  period: SettlementPeriod;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  frozenBalance: string;
  totalsByKind: Record<string, string>;
  generatedAt: string;
}

export interface PartnerBalanceSummaryDto {
  partnerId: string;
  reservedInEscrow: string;
  frozenForDisputes: string;
  dueToPartner: string;
  dueToTutak: string;
  externalPaymentsAwaitingConfirmation: string;
  statements: PartnerSettlementStatementDto[];
}
