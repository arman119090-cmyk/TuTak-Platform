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
};
