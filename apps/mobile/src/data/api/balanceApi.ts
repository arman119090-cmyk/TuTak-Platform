import type { CustomerBalanceDto } from '@tutak/shared-types';
import axios from 'axios';
import { httpClient, ApiEnvelope } from './httpClient';

/**
 * The customer's stored money, as a fact or as "not available" — never as
 * a zero the app made up.
 *
 * `UNAVAILABLE` is the server saying the balance cannot be used for
 * anything on this deployment (the read route answers 404 when neither
 * spending nor top-ups are switched on). It is an answer, and the screens
 * word it as one. A network failure is *not* this: it rejects, and the
 * screens keep saying "could not load".
 */
export type CustomerBalanceAnswer =
  | { state: 'AVAILABLE'; balance: CustomerBalanceDto }
  | { state: 'UNAVAILABLE' };

export const balanceApi = {
  async getMyBalance(): Promise<CustomerBalanceAnswer> {
    try {
      const { data } = await httpClient.get<ApiEnvelope<CustomerBalanceDto>>('/balance/me');
      return { state: 'AVAILABLE', balance: data.data };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { state: 'UNAVAILABLE' };
      }
      throw error;
    }
  },
};
