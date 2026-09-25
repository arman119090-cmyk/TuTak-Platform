import { httpClient, ApiEnvelope } from './httpClient';

interface BalanceDto {
  balance: string;
  currency: string;
}

/** The real-money TuTak balance — separate from bonus points (`walletApi`). Spec §5-6. */
export const customerBalanceApi = {
  async getMyBalance() {
    const { data } = await httpClient.get<ApiEnvelope<BalanceDto>>('/balance/me');
    return data.data;
  },
};
