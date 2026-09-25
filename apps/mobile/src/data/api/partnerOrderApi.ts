import type { PartnerOrderAdjustmentDto, PartnerOrderDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

interface PayResultDto {
  order: PartnerOrderDto;
  insufficientBalance: boolean;
}

interface PayAdditionalResultDto {
  adjustment: PartnerOrderAdjustmentDto;
  insufficientBalance: boolean;
}

/** Spec §5-6, §18: TuTak Checkout and Мои заказы — the customer's own view of Partner Commerce. */
export const partnerOrderApi = {
  async getCheckout(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerOrderDto>>(`/partner-orders/${id}/checkout`);
    return data.data;
  },

  async pay(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PayResultDto>>(`/partner-orders/${id}/pay`);
    return data.data;
  },

  async listMine() {
    const { data } = await httpClient.get<ApiEnvelope<PartnerOrderDto[]>>('/partner-orders/mine');
    return data.data;
  },

  async acceptAdjustment(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderAdjustmentDto>>(
      `/partner-orders/adjustments/${id}/accept`,
    );
    return data.data;
  },

  async declineAdjustment(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerOrderAdjustmentDto>>(
      `/partner-orders/adjustments/${id}/decline`,
    );
    return data.data;
  },

  async payAdditional(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PayAdditionalResultDto>>(
      `/partner-orders/adjustments/${id}/pay-additional`,
    );
    return data.data;
  },
};
