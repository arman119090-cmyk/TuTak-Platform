import type {
  ApprovePurchaseIntentRequestDto,
  PurchaseIntentDto,
  PurchaseIntentStatus,
  RejectPurchaseIntentRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const purchaseIntentApi = {
  async list(partnerId: string, status?: PurchaseIntentStatus) {
    const { data } = await httpClient.get<ApiEnvelope<PurchaseIntentDto[]>>('/purchase-intents', {
      params: { partnerId, status },
    });
    return data.data;
  },

  /**
   * The cashier takes the money and confirms the sale — one act.
   *
   * `dto` carries what they read off the pump or the till. Empty for a
   * percentage partner; required for one paid per unit, where the quantity is
   * what the platform's own share is calculated from.
   */
  async confirm(id: string, dto: ApprovePurchaseIntentRequestDto = {}) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/purchase-intents/${id}/confirm`,
      dto,
    );
    return data.data;
  },

  /**
   * Staff agree what is being sold, so the customer may pay inside TuTak.
   *
   * Only for provider-routed purchases, and it authorises the bill and
   * nothing else: the purchase is completed by the provider's verified
   * callback. A cashier never confirms that provider money arrived — they
   * cannot see the provider's ledger, and a screen that let them say so
   * would be a screen that credits a partner on somebody's guess.
   */
  async approveForPayment(id: string, dto: ApprovePurchaseIntentRequestDto = {}) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/purchase-intents/${id}/approve-for-payment`,
      dto,
    );
    return data.data;
  },

  async reject(id: string, dto: RejectPurchaseIntentRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/purchase-intents/${id}/reject`,
      dto,
    );
    return data.data;
  },
};
