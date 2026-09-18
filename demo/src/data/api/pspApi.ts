import type {
  BeginPspPaymentResponseDto,
  CustomerPaymentStatusDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

/**
 * Paying for a purchase inside TuTak, through a licensed provider.
 *
 * Two calls and no third. `begin` opens a bill and hands back what the client
 * must actually *do* to let the customer pay; `status` is the only thing that
 * may be believed about whether money moved.
 *
 * There is deliberately no "confirm" call. The customer's device cannot
 * establish that a payment succeeded — it can only report where its own
 * browser ended up, and a success page is a page, not a payment. Only a
 * verified provider callback settles anything, and `status` reports what that
 * callback did.
 */
export const pspApi = {
  /**
   * Opens the bill. Refused unless the business has approved the economics
   * first: a provider confirms that money moved, not that a sale happened.
   */
  async begin(purchaseIntentId: string) {
    const { data } = await httpClient.post<ApiEnvelope<BeginPspPaymentResponseDto>>(
      `/psp/purchases/${purchaseIntentId}/begin`,
    );
    return data.data;
  },

  async status(purchaseIntentId: string) {
    const { data } = await httpClient.get<ApiEnvelope<CustomerPaymentStatusDto>>(
      `/psp/purchases/${purchaseIntentId}/status`,
    );
    return data.data;
  },
};
