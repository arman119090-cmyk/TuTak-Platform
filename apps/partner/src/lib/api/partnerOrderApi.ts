import type {
  MyShiftDto,
  EmployeeShiftDto,
  OrderDisputeDto,
  PartnerBalanceSummaryDto,
  PartnerOrderDto,
  PartnerOrderQueueFilter,
  PartnerOrderReturnDto,
  PartnerSettlementStatementDto,
  RejectStockRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/**
 * The Partner Cabinet's side of Partner Commerce (spec §16, §24-27, §44-47,
 * §50-54, §75). Nothing here can mark an electronic payment paid, change a
 * commission, or move money out: those routes do not exist for a partner.
 */
export const partnerOrderApi = {
  async list(partnerId: string, filter?: PartnerOrderQueueFilter) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerOrderDto[]>>('/partner-orders', {
      params: { partnerId, filter },
    });
    return data.data;
  },

  async markSeen(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/seen`);
    return data.data;
  },

  async confirmStock(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/confirm-stock`);
    return data.data;
  },

  async rejectStock(id: string, dto: RejectStockRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/reject-stock`, dto);
    return data.data;
  },

  async handedOver(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/handed-over`);
    return data.data;
  },

  async confirmExternal(legId: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/legs/${legId}/confirm-external`);
    return data.data;
  },

  async correctExternal(legId: string, reason: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/legs/${legId}/correct-external`, {
      reason,
    });
    return data.data;
  },

  async confirmExternalReturn(legId: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(
      `/partner-orders/legs/${legId}/confirm-external-return`,
    );
    return data.data;
  },

  async createReturn(id: string, body: { amount?: string; reason: string; idempotencyKey: string }) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderReturnDto>>(`/partner-orders/${id}/returns`, body);
    return data.data;
  },

  async confirmReturnExternalRefund(returnId: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderReturnDto>>(
      `/partner-orders/returns/${returnId}/confirm-external-refund`,
    );
    return data.data;
  },

  async openDispute(id: string, body: { type: 'ORDER' | 'PAYMENT'; reason: string; description?: string }) {
    const { data } = await httpClient.post<ApiEnvelope<OrderDisputeDto>>(`/partner-orders/${id}/partner-disputes`, body);
    return data.data;
  },

  async commentDispute(disputeId: string, body: string) {
    const { data } = await httpClient.post<ApiEnvelope<unknown>>(`/partner-orders/disputes/${disputeId}/comments`, { body });
    return data.data;
  },
};

/** "Начать смену / Завершить смену" (spec §6, §75). */
export const shiftApi = {
  async me(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<MyShiftDto>>('/shifts/me', { params: { partnerId } });
    return data.data;
  },

  async start(branchId: string) {
    const { data } = await httpClient.post<ApiEnvelope<EmployeeShiftDto>>('/shifts/start', { branchId });
    return data.data;
  },

  async end() {
    const { data } = await httpClient.post<ApiEnvelope<EmployeeShiftDto | null>>('/shifts/end');
    return data.data;
  },
};

/** Spec §50, §77: read-only settlement view — there is no withdraw. */
export const settlementApi = {
  async summary(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBalanceSummaryDto>>(`/settlement/partners/${partnerId}/summary`);
    return data.data;
  },

  async statement(id: string) {
    const { data } = await httpClient.get<
      ApiEnvelope<PartnerSettlementStatementDto & { lines: { id: string; kind: string; sourceType: string; sourceId: string; signedAmount: string; postedAt: string; accountType: string }[] }>
    >(`/settlement/statements/${id}`);
    return data.data;
  },
};

export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return fallback;
}
