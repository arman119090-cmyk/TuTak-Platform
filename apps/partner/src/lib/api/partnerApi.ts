import type { PartnerAnalyticsDto, PartnerDto, TransactionDto, PaginatedResultDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const partnerApi = {
  async get(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerDto>>(`/partners/${id}`);
    return data.data;
  },

  async transactions(id: string, cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PaginatedResultDto<TransactionDto>>>(
      `/partners/${id}/transactions`,
      { params: { cursor } },
    );
    return data.data;
  },

  async analytics(id: string, from?: string, to?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerAnalyticsDto>>(`/analytics/partners/${id}`, {
      params: { from, to },
    });
    return data.data;
  },
};
