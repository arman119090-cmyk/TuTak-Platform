import type { PurchaseIntentDto, PurchaseIntentStatus, RejectPurchaseIntentRequestDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const purchaseIntentApi = {
  async list(partnerId: string, status?: PurchaseIntentStatus) {
    const { data } = await httpClient.get<ApiEnvelope<PurchaseIntentDto[]>>('/purchase-intents', {
      params: { partnerId, status },
    });
    return data.data;
  },

  async confirm(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/purchase-intents/${id}/confirm`,
    );
    return data.data;
  },

  async reject(id: string, dto: RejectPurchaseIntentRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/purchase-intents/${id}/reject`,
      dto,
    );
    return data.data;
  },
};
