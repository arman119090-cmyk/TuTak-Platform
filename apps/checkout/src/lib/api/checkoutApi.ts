import type {
  AuthResponseDto,
  CustomerPartnerOrderDto,
  PartnerOrderCheckoutDto,
  SubmitPartnerOrderRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

/**
 * Exactly the endpoints the mobile app uses — one backend, one order, one
 * state machine, one ledger, one set of idempotency rules (Q12). There is no
 * guest path: every order call needs a signed-in TuTak customer.
 */
export const checkoutApi = {
  async requestLoginOtp(phone: string) {
    await httpClient.post('/auth/login/request-otp', { phone });
  },

  async verifyLoginOtp(phone: string, code: string, deviceId: string) {
    const { data } = await httpClient.post<ApiEnvelope<AuthResponseDto>>('/auth/login/verify-otp', {
      phone,
      code,
      deviceId,
      deviceName: 'TuTak Web Checkout',
    });
    return data.data;
  },

  async getCheckout(orderId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerOrderCheckoutDto>>(`/partner-orders/${orderId}/checkout`);
    return data.data;
  },

  async submit(orderId: string, body: SubmitPartnerOrderRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<CustomerPartnerOrderDto>>(`/partner-orders/${orderId}/submit`, body);
    return data.data;
  },
};

export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return fallback;
}

/** The mobile app's own deep link for the same order (`tutak://checkout/<id>`). */
export function appCheckoutUrl(orderId: string): string {
  return `tutak://checkout/${encodeURIComponent(orderId)}`;
}
