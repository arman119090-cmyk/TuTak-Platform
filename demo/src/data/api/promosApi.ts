import type { PartnerPromoEventType, PartnerPromoLocale, PartnerPromoPublicDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

/**
 * Home "Partner Spotlight" — the curated featured-partner strip.
 *
 * Read-only from the app's point of view apart from two counters. Nothing
 * here is personal: the strip is the same for everyone, and an event names
 * a card, not a person.
 */
export const promosApi = {
  /**
   * The cards to show now, in order, in the interface language. Empty means
   * the strip is not drawn. The API falls back requested → ru → first
   * filled language and reports which one it used in `locale`.
   */
  async featured(locale: PartnerPromoLocale) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerPromoPublicDto[]>>('/promos/featured', {
      params: { locale },
    });
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
