import type {
  AuthTokens,
  BalanceDto,
  ConfirmWithdrawalDto,
  CreateQuoteDto,
  DriverProfileDto,
  LinkDriverDto,
  PayoutMethodDto,
  QuoteDto,
  RequestOtpResponse,
  SessionDto,
  WithdrawalDto,
  WithdrawalListDto,
  WithdrawalTimelineEntryDto,
} from '@cashout/contracts';
import type { ApiClient } from './client';

/** One place that knows the API's shape, so screens never build URLs. */
export const endpoints = {
  requestOtp: (api: ApiClient, body: { phone: string; deviceId: string; locale: string }) =>
    api.request<RequestOtpResponse>('/v1/auth/otp/request', {
      method: 'POST',
      body,
      anonymous: true,
    }),

  verifyOtp: (
    api: ApiClient,
    body: { challengeId: string; code: string; deviceId: string; platform?: string },
  ) =>
    api.request<AuthTokens & { isNewUser: boolean }>('/v1/auth/otp/verify', {
      method: 'POST',
      body,
      anonymous: true,
    }),

  me: (api: ApiClient) => api.request<DriverProfileDto>('/v1/me'),

  link: (api: ApiClient, body: LinkDriverDto) =>
    api.request<DriverProfileDto>('/v1/me/link', { method: 'POST', body }),

  setLocale: (api: ApiClient, locale: string) =>
    api.request<{ ok: boolean }>('/v1/me/locale', { method: 'PATCH', body: { locale } }),

  balance: (api: ApiClient) => api.request<BalanceDto>('/v1/me/balance'),

  payoutMethods: (api: ApiClient) =>
    api.request<{ items: PayoutMethodDto[] }>('/v1/payout-methods'),

  addCard: (api: ApiClient, providerToken: string, currency: string) =>
    api.request<PayoutMethodDto>('/v1/payout-methods', {
      method: 'POST',
      body: { kind: 'CARD', providerToken, currency, setAsDefault: true },
    }),

  removePayoutMethod: (api: ApiClient, id: string) =>
    api.request<void>(`/v1/payout-methods/${id}`, { method: 'DELETE' }),

  makeDefaultPayoutMethod: (api: ApiClient, id: string) =>
    api.request<void>(`/v1/payout-methods/${id}/default`, { method: 'POST' }),

  quote: (api: ApiClient, body: CreateQuoteDto) =>
    api.request<QuoteDto>('/v1/withdrawals/quote', { method: 'POST', body }),

  confirm: (api: ApiClient, body: ConfirmWithdrawalDto) =>
    api.request<WithdrawalDto>('/v1/withdrawals', { method: 'POST', body }),

  withdrawal: (api: ApiClient, id: string) =>
    api.request<WithdrawalDto>(`/v1/withdrawals/${id}`),

  withdrawals: (api: ApiClient, cursor?: string) =>
    api.request<WithdrawalListDto>(
      `/v1/withdrawals?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  timeline: (api: ApiClient, id: string) =>
    api.request<{ items: WithdrawalTimelineEntryDto[] }>(`/v1/withdrawals/${id}/timeline`),

  sessions: (api: ApiClient) => api.request<{ items: SessionDto[] }>('/v1/auth/sessions'),
};
