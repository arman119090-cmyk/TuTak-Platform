import type { PartnerPromoEventType, PartnerPromoPublicDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

/**
 * Home "Partner Spotlight" — the curated featured-partner strip.
 *
 * Read-only from the app's point of view apart from two counters. Nothing
 * here is personal: the strip is the same for everyone, and an event names
 * a card, not a person.
 */
export const promosApi = {
  /** The cards to show now, in order. Empty means the strip is not drawn. */
  async featured() {
    const { data } = await httpClient.get<ApiEnvelope<PartnerPromoPublicDto[]>>('/promos/featured');
    return data.data;
  },

  /**
   * Fire-and-forget. A failed ping is swallowed by the caller: an analytics
   * counter is not worth an error banner, a retry loop or a blocked tap.
   */
  async event(promoId: string, type: PartnerPromoEventType) {
    await httpClient.post(`/promos/${promoId}/events`, { type });
  },
};
