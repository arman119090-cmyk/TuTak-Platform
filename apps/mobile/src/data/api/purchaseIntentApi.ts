import type { CreatePurchaseIntentRequestDto, PurchaseIntentDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const purchaseIntentApi = {
  async create(dto: CreatePurchaseIntentRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>('/purchase-intents', dto);
    return data.data;
  },

  async get(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PurchaseIntentDto>>(`/purchase-intents/${id}`);
    return data.data;
  },

  /**
   * Withdraws a purchase no cashier has acted on yet. Returns the intent's
   * real state, which on a lost race is what the cashier did instead — the
   * caller should render what comes back rather than assume a cancellation.
   */
  async cancel(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/purchase-intents/${id}/cancel`,
    );
    return data.data;
  },
};
