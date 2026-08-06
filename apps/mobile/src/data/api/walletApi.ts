import type {
  BonusLedgerEntryDto,
  BonusLotDto,
  PaginatedResultDto,
  WalletBalanceDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const walletApi = {
  async getMyWallet() {
    const { data } = await httpClient.get<ApiEnvelope<WalletBalanceDto>>('/wallet/me');
    return data.data;
  },

  async getMyLedger(cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PaginatedResultDto<BonusLedgerEntryDto>>>(
      '/wallet/me/ledger',
      { params: { cursor } },
    );
    return data.data;
  },

  async getMyLots() {
    const { data } = await httpClient.get<ApiEnvelope<BonusLotDto[]>>('/wallet/me/lots');
    return data.data;
  },
};
