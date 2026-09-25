import {
  OrderEscalationType,
  PartnerOrderAdjustmentStatus,
  PartnerOrderAdjustmentType,
  PartnerOrderPaymentStatus,
  PartnerOrderStatus,
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

/** Partner/admin view — the customer-facing view omits staff/SLA-only fields, see the API's own `toCustomerView`. */
export interface PartnerOrderDto {
  id: string;
  orderNumber: number;
  customerId: string | null;
  partnerId: string;
  externalOrderId: string;
  currency: string;
  subtotal: string;
  totalAmount: string;
  commissionAmount: string;
  partnerAmount: string;
  paymentStatus: PartnerOrderPaymentStatus;
  orderStatus: PartnerOrderStatus;
  sourcingAllowed: boolean;
  refundedAmount: string;
  rejectionReason: string | null;
  createdAt: string;
  paidAt: string | null;
  partnerSeenAt: string | null;
  stockConfirmedAt: string | null;
  stockRejectedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  items: PartnerOrderItemDto[];
}

export interface RejectStockRequestDto {
  reason?: string;
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
  reason: string | null;
  additionalPaymentStatus: PartnerOrderPaymentStatus | null;
  createdAt: string;
  appliedAt: string | null;
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
  order?: PartnerOrderDto;
}

export interface RecordSourcingResultRequestDto {
  status: 'FOUND_EXACT' | 'FOUND_ALTERNATE' | 'NOT_FOUND';
  sourceType?: 'OTHER_TUTAK_PARTNER' | 'EXTERNAL';
  sourcePartnerId?: string;
  productName?: string;
  description?: string;
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
  order?: PartnerOrderDto;
}

export interface CommissionRuleDto {
  id: string;
  partnerId: string | null;
  category: string | null;
  name: string;
  rateBps: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateCommissionRuleRequestDto {
  partnerId: string | null;
  category?: string;
  name: string;
  rateBps: number;
}
