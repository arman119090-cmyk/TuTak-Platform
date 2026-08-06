import { httpClient } from '../httpClient';

export const walletApi = {
  async manualAdjust(userId: string, amount: string, direction: 'CREDIT' | 'DEBIT', reason: string) {
    const { data } = await httpClient.post('/wallet/admin/adjust', { userId, amount, direction, reason });
    return data.data;
  },
};
