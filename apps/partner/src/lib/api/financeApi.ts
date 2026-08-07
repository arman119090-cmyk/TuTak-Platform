import { httpClient } from '../httpClient';

export interface Settlement {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  commissionAmount: string;
  netAmount: string;
  bonusAccrued: string;
  paymentCount: number;
}

export interface Payout {
  id: string;
  amount: string;
  status: 'REQUESTED' | 'PAID' | 'FAILED';
  bankReference: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const financeApi = {
  async balance(partnerId: string): Promise<{ availableBalance: string; currency: string }> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/balance`);
    return data.data;
  },

  async settlements(partnerId: string): Promise<Settlement[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/settlements`);
    return data.data;
  },

  async payouts(partnerId: string): Promise<Payout[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}`);
    return data.data;
  },
};
