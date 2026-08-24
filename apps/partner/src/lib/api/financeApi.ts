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

export interface PartnerCollection {
  id: string;
  amount: string;
  bankReference: string;
  createdAt: string;
}

/** Real QR/PurchaseIntent activity, grouped by day — see `dailyActivity` below. */
export interface ActivityDay {
  periodStart: string;
  grossAmount: string;
  discountGivenAmount: string;
  commissionOwedAmount: string;
  netAmount: string;
  purchaseCount: number;
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

  /** The other settlement direction: this partner's own transfers to TuTak. */
  async collections(partnerId: string): Promise<PartnerCollection[]> {
    const { data } = await httpClient.get(`/payouts/partners/${partnerId}/collections`);
    return data.data;
  },

  /**
   * Real confirmed-purchase activity for a partner running the live QR flow
   * — `settlements` above only ever has rows for the legacy card-payment
   * pipeline, which stays off in production.
   */
  async dailyActivity(partnerId: string): Promise<ActivityDay[]> {
    const { data } = await httpClient.get('/purchase-intents/activity/daily', {
      params: { partnerId },
    });
    return data.data;
  },
};
