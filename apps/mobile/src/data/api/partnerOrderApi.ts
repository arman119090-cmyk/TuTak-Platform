import type {
  AcceptAdjustmentRequestDto,
  CustomerPartnerOrderDto,
  OrderDisputeDto,
  PartnerOrderCheckoutDto,
  SubmitPartnerOrderRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

/**
 * Partner Commerce, the customer's side (spec §4, §20-23, §31-34, §43, §48):
 * the checkout for an order a partner's website created, "Подтвердить
 * заказ", "Получил заказ", cancel, reporting a problem, and answering a
 * sourcing proposal. Every amount the customer sees is computed by the
 * server; this client only ever sends the customer's own choice of split.
 */
export const partnerOrderApi = {
  async getCheckout(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerOrderCheckoutDto>>(`/partner-orders/${id}/checkout`);
    return data.data;
  },

  async submit(id: string, body: SubmitPartnerOrderRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<CustomerPartnerOrderDto>>(`/partner-orders/${id}/submit`, body);
    return data.data;
  },

  async listMine() {
    const { data } = await httpClient.get<ApiEnvelope<CustomerPartnerOrderDto[]>>('/partner-orders/mine');
    return data.data;
  },

  async confirmReceived(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<CustomerPartnerOrderDto>>(`/partner-orders/${id}/received`);
    return data.data;
  },

  async cancel(id: string, reason?: string) {
    const { data } = await httpClient.post<ApiEnvelope<CustomerPartnerOrderDto>>(`/partner-orders/${id}/cancel`, { reason });
    return data.data;
  },

  async openDispute(id: string, reason: string, description?: string) {
    const { data } = await httpClient.post<ApiEnvelope<OrderDisputeDto>>(`/partner-orders/${id}/disputes`, {
      type: 'ORDER',
      reason,
      description,
    });
    return data.data;
  },

  async acceptAdjustment(id: string, body: AcceptAdjustmentRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<CustomerPartnerOrderDto>>(
      `/partner-orders/adjustments/${id}/accept`,
      body,
    );
    return data.data;
  },

  async declineAdjustment(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<CustomerPartnerOrderDto>>(
      `/partner-orders/adjustments/${id}/decline`,
    );
    return data.data;
  },
};
