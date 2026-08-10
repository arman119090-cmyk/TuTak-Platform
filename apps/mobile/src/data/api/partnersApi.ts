import type { NearbyPartnerDto, PartnerCategory } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export interface NearbyPartnersQuery {
  lat: number;
  lng: number;
  radiusKm?: number;
  category?: PartnerCategory;
  /** Free text over the partner's name, the branch, and the street. */
  q?: string;
}

export const partnersApi = {
  /**
   * Branches a customer can walk into, nearest first.
   *
   * Empty filters are omitted rather than sent as empty strings: the API
   * validates with `forbidNonWhitelisted` and an empty `q` would be a search
   * for nothing, which matches everything — the opposite of what an empty
   * search box means.
   */
  async nearby(query: NearbyPartnersQuery) {
    const { data } = await httpClient.get<ApiEnvelope<NearbyPartnerDto[]>>('/partners/nearby', {
      params: {
        lat: query.lat,
        lng: query.lng,
        radiusKm: query.radiusKm ?? 10,
        ...(query.category ? { category: query.category } : {}),
        ...(query.q?.trim() ? { q: query.q.trim() } : {}),
      },
    });
    return data.data;
  },
};
