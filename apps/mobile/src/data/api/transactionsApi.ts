import type { PaginatedResultDto, TransactionDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const transactionsApi = {
  async myHistory(cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PaginatedResultDto<TransactionDto>>>(
      '/transactions/me',
      { params: { cursor } },
    );
    return data.data;
  },
};
