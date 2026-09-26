/** Partner Commerce v2 — mirrors the Prisma enums (apps/api/prisma/schema.prisma). */

export enum PartnerOrderOperationalStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  SEEN = 'SEEN',
  STOCK_CONFIRMED = 'STOCK_CONFIRMED',
  HANDED_OVER = 'HANDED_OVER',
  RECEIVED = 'RECEIVED',
  COMPLETED = 'COMPLETED',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum PartnerOrderPaymentStatus {
  UNFUNDED = 'UNFUNDED',
  PARTIALLY_FUNDED = 'PARTIALLY_FUNDED',
  RESERVED = 'RESERVED',
  FUNDED = 'FUNDED',
  SETTLED = 'SETTLED',
  REFUND_PENDING = 'REFUND_PENDING',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
}

export enum PartnerOrderSourcingStatus {
  NONE = 'NONE',
  REQUIRED = 'REQUIRED',
  SEARCHING = 'SEARCHING',
  AWAITING_CUSTOMER = 'AWAITING_CUSTOMER',
  RESOLVED = 'RESOLVED',
  FAILED = 'FAILED',
}

export enum PartnerOrderDisputeStatus {
  NONE = 'NONE',
  OPEN = 'OPEN',
  RESOLVED_CUSTOMER = 'RESOLVED_CUSTOMER',
  RESOLVED_PARTNER = 'RESOLVED_PARTNER',
  RESOLVED_SPLIT = 'RESOLVED_SPLIT',
}

export enum PaymentLegType {
  DISCOUNT = 'DISCOUNT',
  TUTAK_MONEY = 'TUTAK_MONEY',
  EXTERNAL = 'EXTERNAL',
}

export enum PaymentLegStatus {
  PENDING = 'PENDING',
  CAPTURED = 'CAPTURED',
  CONFIRMED = 'CONFIRMED',
  CORRECTED = 'CORRECTED',
  SETTLED = 'SETTLED',
  RETURN_PENDING = 'RETURN_PENDING',
  RETURNED = 'RETURNED',
}

export enum SourcingTaskStatus {
  OPEN = 'OPEN',
  SEARCHING = 'SEARCHING',
  FOUND_EXACT = 'FOUND_EXACT',
  FOUND_ALTERNATE = 'FOUND_ALTERNATE',
  NOT_FOUND = 'NOT_FOUND',
  RESOLVED = 'RESOLVED',
}

export enum PartnerOrderAdjustmentType {
  PRICE_DECREASE = 'PRICE_DECREASE',
  PRICE_INCREASE = 'PRICE_INCREASE',
  ALTERNATE_PRODUCT = 'ALTERNATE_PRODUCT',
  SAME_ITEM_OTHER_SOURCE = 'SAME_ITEM_OTHER_SOURCE',
  SOURCING_FAILED_REFUND = 'SOURCING_FAILED_REFUND',
  OUT_OF_STOCK_REFUND = 'OUT_OF_STOCK_REFUND',
}

export enum PartnerOrderAdjustmentStatus {
  PENDING_CUSTOMER = 'PENDING_CUSTOMER',
  CUSTOMER_ACCEPTED = 'CUSTOMER_ACCEPTED',
  CUSTOMER_DECLINED = 'CUSTOMER_DECLINED',
  APPLIED = 'APPLIED',
}

export enum OrderEscalationType {
  NOT_SEEN_5MIN = 'NOT_SEEN_5MIN',
  STOCK_NOT_CONFIRMED_30MIN = 'STOCK_NOT_CONFIRMED_30MIN',
  STOCK_NOT_CONFIRMED_REPEAT = 'STOCK_NOT_CONFIRMED_REPEAT',
  RECEIPT_NOT_CONFIRMED_48H = 'RECEIPT_NOT_CONFIRMED_48H',
  PAYMENT_ISSUE = 'PAYMENT_ISSUE',
}

export enum PartnerOrderReturnStatus {
  PENDING_EXTERNAL_REFUND = 'PENDING_EXTERNAL_REFUND',
  COMPLETED = 'COMPLETED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

export enum OrderDisputeType {
  ORDER = 'ORDER',
  PAYMENT = 'PAYMENT',
}

export enum OrderDisputeStatus {
  OPEN = 'OPEN',
  RESOLVED_CUSTOMER = 'RESOLVED_CUSTOMER',
  RESOLVED_PARTNER = 'RESOLVED_PARTNER',
  RESOLVED_SPLIT = 'RESOLVED_SPLIT',
}

export enum SettlementPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
}

/** The neutral customer-facing status the API derives (never internal SLA state). */
export type PartnerOrderCustomerStatus =
  | 'awaiting_confirmation'
  | 'checking_availability'
  | 'decision_required'
  | 'confirmed'
  | 'on_the_way'
  | 'received'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled'
  | 'cancelled_refund_pending'
  | 'expired';

/** Spec §55's admin queues. */
export type PartnerOrderAdminQueue =
  | 'all'
  | 'new'
  | 'not_seen'
  | 'stock_not_confirmed'
  | 'sourcing_required'
  | 'searching'
  | 'customer_action'
  | 'payment_issue'
  | 'refund_required'
  | 'disputes'
  | 'critical'
  | 'manual_review'
  | 'completed';

/** Spec §53's partner filters. */
export type PartnerOrderQueueFilter =
  | 'new'
  | 'seen'
  | 'stock_confirmed'
  | 'out_of_stock'
  | 'handed_over'
  | 'completed'
  | 'cancelled'
  | 'refund'
  | 'dispute';
