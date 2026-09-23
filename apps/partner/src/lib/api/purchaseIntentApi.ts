import type {
  ApprovePurchaseIntentRequestDto,
  PendingExternalRefundDto,
  PurchaseHistoryDto,
  PurchaseIntentDto,
  PurchaseIntentStatus,
  RejectPurchaseIntentRequestDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const purchaseIntentApi = {
  /**
   * Everything that happened to one purchase, not just who confirmed it.
   *
   * Separate from the settlement breakdown on purpose: this says what
   * happened, that one says what is owed, and they are gated on different
   * permissions because they answer different questions.
   */
  async history(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PurchaseHistoryDto>>(
      `/purchase-intents/${id}/history`,
    );
    return data.data;
  },

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

  /** Refunds whose cash slice the business still has to hand back (§26). */
  async pendingExternalRefunds(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PendingExternalRefundDto[]>>(
      '/purchase-intents/refunds/pending-external',
      { params: { partnerId } },
    );
    return data.data;
  },

  /** The business states the cash was handed back. Idempotent on the server. */
  async confirmExternalRefund(refundId: string) {
    const { data } = await httpClient.post<ApiEnvelope<{ id: string; externalRefundStatus: string }>>(
      `/purchase-intents/refunds/${refundId}/confirm-external`,
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
