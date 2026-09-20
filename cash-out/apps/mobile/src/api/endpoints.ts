import type {
  AuthorizationDto,
  AuthorizeDto,
  AuthTokens,
  AutoPayoutRuleDto,
  AutoPayoutStateDto,
  ChangePinDto,
  DriverIdChangeRequestDto,
  DriverIdStateDto,
  BalanceDto,
  ConfirmWithdrawalDto,
  CreateQuoteDto,
  DriverProfileDto,
  HistoryEntryDetailDto,
  HistoryPageDto,
  LinkIdramAccountDto,
  MembershipDto,
  NotificationPreferencesDto,
  PayoutMethodDto,
  QuoteDto,
  RequestOtpResponse,
  SecurityStatusDto,
  UpdateNotificationPreferencesDto,
  UpsertAutoPayoutDto,
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

  parks: (api: ApiClient) => api.request<{ items: MembershipDto[] }>('/v1/me/parks'),

  activatePark: (api: ApiClient, parkId: string) =>
    api.request<DriverProfileDto>('/v1/me/parks/activate', { method: 'POST', body: { parkId } }),

  setLocale: (api: ApiClient, locale: string) =>
    api.request<{ ok: boolean }>('/v1/me/locale', { method: 'PATCH', body: { locale } }),

  balance: (api: ApiClient) => api.request<BalanceDto>('/v1/me/balance'),

  driverId: (api: ApiClient) => api.request<DriverIdStateDto>('/v1/me/driver-id'),

  requestDriverIdChange: (api: ApiClient, newDriverId: string) =>
    api.request<DriverIdChangeRequestDto>('/v1/me/driver-id/requests', {
      method: 'POST',
      body: { newDriverId },
    }),

  cancelDriverIdRequest: (api: ApiClient, id: string) =>
    api.request<void>(`/v1/me/driver-id/requests/${id}/cancel`, { method: 'POST' }),

  /** A fresh read from the fleet, never the cache. Required before withdrawing. */
  freshBalance: (api: ApiClient) => api.request<BalanceDto>('/v1/me/balance/fresh'),

  payoutMethods: (api: ApiClient) =>
    api.request<{ items: PayoutMethodDto[] }>('/v1/payout-methods'),

  addCard: (api: ApiClient, providerToken: string, currency: string) =>
    api.request<PayoutMethodDto>('/v1/payout-methods', {
      method: 'POST',
      body: { kind: 'CARD', providerToken, currency, setAsDefault: true },
    }),

  idramAccount: (api: ApiClient) =>
    api.request<{ account: PayoutMethodDto | null }>('/v1/idram/account'),

  linkIdram: (api: ApiClient, body: LinkIdramAccountDto) =>
    api.request<PayoutMethodDto>('/v1/idram/account', { method: 'POST', body }),

  unlinkIdram: (api: ApiClient) => api.request<void>('/v1/idram/account', { method: 'DELETE' }),

  removePayoutMethod: (api: ApiClient, id: string) =>
    api.request<void>(`/v1/payout-methods/${id}`, { method: 'DELETE' }),

  makeDefaultPayoutMethod: (api: ApiClient, id: string) =>
    api.request<void>(`/v1/payout-methods/${id}/default`, { method: 'POST' }),

  quote: (api: ApiClient, body: CreateQuoteDto) =>
    api.request<QuoteDto>('/v1/withdrawals/quote', { method: 'POST', body }),

  confirm: (api: ApiClient, body: ConfirmWithdrawalDto) =>
    api.request<WithdrawalDto>('/v1/withdrawals', { method: 'POST', body }),

  withdrawal: (api: ApiClient, id: string) => api.request<WithdrawalDto>(`/v1/withdrawals/${id}`),

  withdrawals: (api: ApiClient, cursor?: string) =>
    api.request<WithdrawalListDto>(
      `/v1/withdrawals?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  history: (
    api: ApiClient,
    filter: { from?: string; to?: string; type?: string; status?: string; cursor?: string },
  ) => {
    const query = new URLSearchParams({ limit: '20' });
    for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
    return api.request<HistoryPageDto>(`/v1/history?${query.toString()}`);
  },

  historyDetail: (api: ApiClient, id: string) =>
    api.request<HistoryEntryDetailDto>(`/v1/history/${encodeURIComponent(id)}`),

  timeline: (api: ApiClient, id: string) =>
    api.request<{ items: WithdrawalTimelineEntryDto[] }>(`/v1/withdrawals/${id}/timeline`),

  sessions: (api: ApiClient) => api.request<{ items: SessionDto[] }>('/v1/auth/sessions'),

  securityStatus: (api: ApiClient) => api.request<SecurityStatusDto>('/v1/security'),

  setPin: (api: ApiClient, pin: string) =>
    api.request<void>('/v1/security/pin', { method: 'POST', body: { pin } }),

  changePin: (api: ApiClient, body: ChangePinDto) =>
    api.request<void>('/v1/security/pin/change', { method: 'POST', body }),

  enableBiometric: (api: ApiClient, pin: string) =>
    api.request<{ deviceSecret: string }>('/v1/security/biometric/enable', {
      method: 'POST',
      body: { pin },
    }),

  disableBiometric: (api: ApiClient) =>
    api.request<void>('/v1/security/biometric/disable', { method: 'POST' }),

  autoPayout: (api: ApiClient) => api.request<AutoPayoutStateDto>('/v1/auto-payout'),

  upsertAutoPayout: (api: ApiClient, body: UpsertAutoPayoutDto) =>
    api.request<AutoPayoutRuleDto>('/v1/auto-payout', { method: 'PUT', body }),

  disableAutoPayout: (api: ApiClient) =>
    api.request<void>('/v1/auto-payout/disable', { method: 'POST' }),

  notificationPreferences: (api: ApiClient) =>
    api.request<NotificationPreferencesDto>('/v1/notifications/preferences'),

  updateNotificationPreferences: (api: ApiClient, body: UpdateNotificationPreferencesDto) =>
    api.request<NotificationPreferencesDto>('/v1/notifications/preferences', {
      method: 'PUT',
      body,
    }),

  registerPushToken: (api: ApiClient, token: string, platform: 'ios' | 'android') =>
    api.request<void>('/v1/notifications/push-token', {
      method: 'POST',
      body: { token, platform },
    }),

  /** A single-use authorization for a money operation. */
  authorize: (api: ApiClient, body: AuthorizeDto) =>
    api.request<AuthorizationDto>('/v1/security/authorize', { method: 'POST', body }),
};
