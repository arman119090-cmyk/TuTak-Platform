import type {
  CreatePurchaseIntentRequestDto,
  FundingQuoteDto,
  PurchaseIntentDto,
  PurchaseIntentRefundDto,
  QuotePurchaseIntentRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const purchaseIntentApi = {
  async create(dto: CreatePurchaseIntentRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>('/purchase-intents', dto);
    return data.data;
  },

  /**
   * The server's breakdown before a purchase exists — what bonus and
   * balance cover and what is still due at the till. The app shows these
   * figures; it never does the arithmetic itself once they arrive.
   */
  async quote(dto: QuotePurchaseIntentRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<FundingQuoteDto>>('/purchase-intents/quote', dto);
    return data.data;
  },

  async get(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PurchaseIntentDto>>(`/purchase-intents/${id}`);
    return data.data;
  },

  /** Every refund recorded against one of the customer's own purchases. */
  async refunds(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PurchaseIntentRefundDto[]>>(
      `/purchase-intents/${id}/refunds`,
    );
    return data.data;
  },

  /**
   * Withdraws a purchase no cashier has acted on yet. Returns the intent's
   * real state, which on a lost race is what the cashier did instead — the
   * caller should render what comes back rather than assume a cancellation.
   */
  async cancel(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/purchase-intents/${id}/cancel`,
    );
    return data.data;
  },
};
