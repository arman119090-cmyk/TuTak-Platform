import { httpClient, ApiEnvelope } from './httpClient';

interface BalanceDto {
  balance: string;
  currency: string;
}

interface TopUpResultDto {
  topUpId: string;
  status: string;
  amount: string;
  declineReason?: string;
  redirectUrl?: string;
}

/**
 * The real-money TuTak balance (`CUSTOMER_PREPAID_BALANCE`) — separate from
 * the green discount balance (`walletApi`), and never mixed with it (Q1).
 */
export const customerBalanceApi = {
  async getMyBalance() {
    const { data } = await httpClient.get<ApiEnvelope<BalanceDto>>('/balance/me');
    return data.data;
  },

  /**
   * Spec §22: top up exactly what is missing. Until a real bank adapter
   * (IDRAM) is connected the server declines with `top_up_not_configured`.
   */
  async topUp(amount: string, idempotencyKey: string) {
    const { data } = await httpClient.post<ApiEnvelope<TopUpResultDto>>('/balance/topup', { amount, idempotencyKey });
    return data.data;
  },
};
