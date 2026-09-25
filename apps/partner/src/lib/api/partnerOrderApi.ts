import type { PartnerOrderDto, PartnerOrderStatus, RejectStockRequestDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/** Spec §7, §10-12: the Partner Cabinet's own view of an order — never a still-unpaid CREATED one, see the API's own `listForPartner`. */
export const partnerOrderApi = {
  async list(partnerId: string, status?: PartnerOrderStatus) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerOrderDto[]>>('/partner-orders', {
      params: { partnerId, status },
    });
    return data.data;
  },

  async markSeen(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/seen`);
    return data.data;
  },

  async confirmStock(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(
      `/partner-orders/${id}/confirm-stock`,
    );
    return data.data;
  },

  async rejectStock(id: string, dto: RejectStockRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderDto>>(
      `/partner-orders/${id}/reject-stock`,
      dto,
    );
    return data.data;
  },
};
