import type {
  ClaimCancellationCostRequestDto,
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

  /** Item 7: handed to the partner's own courier — no customer timer starts. */
  async outForDelivery(id: string, courierNote?: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/out-for-delivery`, { courierNote });
    return data.data;
  },

  /** Item 7: waiting at the branch for self-pickup — no customer timer starts. */
  async readyForPickup(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/ready-for-pickup`);
    return data.data;
  },

  /** Item 7: actually delivered / handed to the customer — the 24h/48h clock starts. */
  async delivered(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/delivered`);
    return data.data;
  },

  /** Item 8: no costs — the customer's cancellation proceeds with a full refund. */
  async cancellationNoCost(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/cancellation/no-cost`);
    return data.data;
  },

  /** Item 8: an actual, previously disclosed cost; TuTak decides. On shift. */
  async cancellationClaimCost(id: string, body: ClaimCancellationCostRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/cancellation/claim-cost`, body);
    return data.data;
  },

  /** Q9: the desk settlement with the customer, echoing the amount shown. On shift. */
  async settleReturnShortfall(returnId: string, collectedAmount: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderReturnDto>>(
      `/partner-orders/returns/${returnId}/settle-shortfall`,
      { collectedAmount },
    );
    return data.data;
  },

  /** Q9: the customer refuses — TuTak reviews; nothing moves. */
  async refuseReturnShortfall(returnId: string, note: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderReturnDto>>(
      `/partner-orders/returns/${returnId}/refuse-shortfall`,
      { note },
    );
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

  /** One period of the partner's cadence, line by line — `at` is any instant inside it. */
  async statement(partnerId: string, at: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerSettlementStatementDto>>(`/settlement/partners/${partnerId}/statement`, {
      params: { at },
    });
    return data.data;
  },
};

export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return fallback;
}
