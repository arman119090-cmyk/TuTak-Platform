import type {
  CreateRefundRequestRequestDto,
  PurchaseIntentRefundRequestDto,
  RefundRequestStatus,
  RejectRefundRequestRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const refundRequestApi = {
  async list(partnerId: string, status?: RefundRequestStatus) {
    const { data } = await httpClient.get<ApiEnvelope<PurchaseIntentRefundRequestDto[]>>(
      '/purchase-intent-refund-requests',
      { params: { partnerId, status } },
    );
    return data.data;
  },

  async create(purchaseIntentId: string, dto: CreateRefundRequestRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentRefundRequestDto>>(
      '/purchase-intent-refund-requests',
      dto,
      { params: { purchaseIntentId } },
    );
    return data.data;
  },

  async approve(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentRefundRequestDto>>(
      `/purchase-intent-refund-requests/${id}/approve`,
    );
    return data.data;
  },

  async reject(id: string, dto: RejectRefundRequestRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentRefundRequestDto>>(
      `/purchase-intent-refund-requests/${id}/reject`,
      dto,
    );
    return data.data;
  },
};
