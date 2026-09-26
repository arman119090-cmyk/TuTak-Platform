import type {
  AdminPartnerOrderDto,
  DecideCancellationCostRequestDto,
  PartnerOrderCancellationDto,
  PartnerOrderReturnDto,
  ReferralWithholdingDto,
  ReviewShortfallRequestDto,
  CommissionRuleDto,
  CreateCommissionRuleRequestDto,
  CreatePrepaymentRuleRequestDto,
  OrderDisputeDto,
  OrderEscalationDto,
  PartnerOrderAdminQueue,
  PrepaymentRuleDto,
  RecordSourcingResultRequestDto,
  SettlementPeriod,
  SourcingTaskDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/** TuTak's own side of Partner Commerce — queues (§55), sourcing, escalations, disputes, configuration. */
export const partnerOrderAdminApi = {
  async queue(queue: PartnerOrderAdminQueue) {
    const { data } = await httpClient.get<ApiEnvelope<AdminPartnerOrderDto[]>>('/admin/partner-orders/queue', {
      params: { queue },
    });
    return data.data;
  },
  async confirmReceived(id: string, reason: string) {
    await httpClient.post(`/admin/partner-orders/${id}/confirm-received`, { reason });
  },
  async cancelOrder(id: string, reason: string) {
    await httpClient.post(`/admin/partner-orders/${id}/cancel`, { reason });
  },

  async listSourcingTasks() {
    const { data } = await httpClient.get<ApiEnvelope<SourcingTaskDto[]>>('/admin/partner-orders/sourcing-tasks');
    return data.data;
  },
  async claimSourcingTask(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<SourcingTaskDto>>(`/admin/partner-orders/sourcing-tasks/${id}/claim`);
    return data.data;
  },
  async recordSourcingResult(id: string, dto: RecordSourcingResultRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<SourcingTaskDto>>(`/admin/partner-orders/sourcing-tasks/${id}/result`, dto);
    return data.data;
  },

  async listEscalations() {
    const { data } = await httpClient.get<ApiEnvelope<OrderEscalationDto[]>>('/admin/partner-orders/escalations');
    return data.data;
  },
  async claimEscalation(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<OrderEscalationDto>>(`/admin/partner-orders/escalations/${id}/claim`);
    return data.data;
  },
  async resolveEscalation(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<OrderEscalationDto>>(`/admin/partner-orders/escalations/${id}/resolve`);
    return data.data;
  },

  async listDisputes() {
    const { data } = await httpClient.get<ApiEnvelope<OrderDisputeDto[]>>('/admin/partner-orders/disputes');
    return data.data;
  },
  async commentDispute(id: string, body: string) {
    await httpClient.post(`/admin/partner-orders/disputes/${id}/comments`, { body });
  },
  async resolveDispute(
    id: string,
    body: { outcome: 'RESOLVED_CUSTOMER' | 'RESOLVED_PARTNER' | 'RESOLVED_SPLIT'; customerRefundAmount?: string; note: string },
  ) {
    const { data } = await httpClient.post<ApiEnvelope<OrderDisputeDto>>(`/admin/partner-orders/disputes/${id}/resolve`, body);
    return data.data;
  },

  async listCommissionRules(partnerId?: string) {
    const { data } = await httpClient.get<ApiEnvelope<CommissionRuleDto[]>>('/admin/partner-orders/commission-rules', {
      params: { partnerId },
    });
    return data.data;
  },
  async createCommissionRule(dto: CreateCommissionRuleRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<CommissionRuleDto>>('/admin/partner-orders/commission-rules', dto);
    return data.data;
  },
  async deactivateCommissionRule(id: string) {
    await httpClient.post(`/admin/partner-orders/commission-rules/${id}/deactivate`);
  },

  async listPrepaymentRules(partnerId?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PrepaymentRuleDto[]>>('/admin/partner-orders/prepayment-rules', {
      params: { partnerId },
    });
    return data.data;
  },
  async createPrepaymentRule(dto: CreatePrepaymentRuleRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PrepaymentRuleDto>>('/admin/partner-orders/prepayment-rules', dto);
    return data.data;
  },
  async deactivatePrepaymentRule(id: string) {
    await httpClient.post(`/admin/partner-orders/prepayment-rules/${id}/deactivate`);
  },

  // ── Final fixes: cancellation cost review (item 8), shortfall review (Q9), withholdings (Q8)

  async listCancellationReviews() {
    const { data } = await httpClient.get<ApiEnvelope<PartnerOrderCancellationDto[]>>('/admin/partner-orders/cancellations');
    return data.data;
  },
  async cancellationCostCap(orderId: string) {
    const { data } = await httpClient.get<ApiEnvelope<{ external: string; money: string; total: string }>>(
      `/admin/partner-orders/${orderId}/cancellation-cost-cap`,
    );
    return data.data;
  },
  async decideCancellation(id: string, dto: DecideCancellationCostRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderCancellationDto>>(`/admin/partner-orders/cancellations/${id}/decide`, dto);
    return data.data;
  },
  async listReturnReviews() {
    const { data } = await httpClient.get<
      ApiEnvelope<{
        online: (PartnerOrderReturnDto & { order: { id: string; orderNumber: number; partnerId: string; customerId: string | null; totalAmount: string } })[];
        qr: {
          id: string;
          amount: string;
          reason: string;
          customerShortfall: string;
          grossRefund: string;
          recoveredShortfall: string;
          netRefund: string;
          refusalNote: string | null;
          createdAt: string;
          purchaseIntent: { id: string; partnerId: string; customerId: string; grossAmount: string };
        }[];
      }>
    >('/admin/partner-orders/return-reviews');
    return data.data;
  },
  async reviewReturn(id: string, dto: ReviewShortfallRequestDto) {
    await httpClient.post(`/admin/partner-orders/returns/${id}/review`, dto);
  },
  async reviewQrRefund(id: string, dto: ReviewShortfallRequestDto) {
    await httpClient.post(`/admin/partner-orders/purchase-intent-refunds/${id}/review`, dto);
  },
  async listWithholdings(status: 'OPEN' | 'SETTLED' = 'OPEN') {
    const { data } = await httpClient.get<ApiEnvelope<ReferralWithholdingDto[]>>('/admin/partner-orders/referral-withholdings', {
      params: { status },
    });
    return data.data;
  },

  async setSettlementPeriod(partnerId: string, period: SettlementPeriod) {
    await httpClient.post(`/settlement/partners/${partnerId}/period`, { period });
  },
  async requireShiftsFrom(partnerId: string, at: string) {
    await httpClient.post(`/shifts/admin/partners/${partnerId}/required-from`, { at });
  },
};

export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return fallback;
}
