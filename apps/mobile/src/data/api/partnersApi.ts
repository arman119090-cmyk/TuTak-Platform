import type { FuelType, NearbyPartnerDto, PartnerCategory, PartnerPublicDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export interface NearbyPartnersQuery {
  lat: number;
  lng: number;
  radiusKm?: number;
  category?: PartnerCategory;
  /** The "fuel" chip's own sub-filter — "Газ" or "Бензин". Overrides `category` server-side. */
  fuelType?: FuelType;
  /** Free text over the partner's name, the branch, and the street. */
  q?: string;
}

/**
 * What a business tells us when it asks to join.
 *
 * `taxId` is optional here because it is optional on the server: the form is
 * the first contact with a business that has agreed to nothing yet, and a
 * required ՀՎՀՀ at that moment does not produce the number, it loses the
 * applicant. It can be supplied later from the partner's own panel.
 */
export interface PartnerApplication {
  legalName: string;
  displayName: string;
  taxId?: string;
  category: PartnerCategory;
  /**
   * Basis points, on the 0.5% grid the server enforces — 1000 is 10%.
   *
   * The applicant's own proposal. Approval accepts it as it stands, so this
   * is the rate the business will actually trade on.
   */
  bonusAccrualRateBps: number;
}

export const partnersApi = {
  /**
   * Applies to become a partner.
   *
   * Creates the partner awaiting approval — it can accrue nothing, redeem
   * nothing and confirm nothing until an administrator approves it — and
   * makes the caller its owner.
   */
  async apply(application: PartnerApplication) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerPublicDto>>(
      '/partners/apply',
      application,
    );
    return data.data;
  },

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
        ...(query.fuelType ? { fuelType: query.fuelType } : {}),
        ...(query.q?.trim() ? { q: query.q.trim() } : {}),
      },
    });
    return data.data;
  },

  /**
   * The trusted record for one partner, straight from the server —
   * never inferred from anything a QR code or route param claimed. See
   * `CreatePurchaseIntentScreen`'s use of this: a scanned `TUTAK-PAY:<id>`
   * code only ever carries an id, and this is what turns that id into a
   * name and an active/inactive fact the customer can actually trust
   * before committing an amount.
   */
  async get(partnerId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerPublicDto>>(
      `/partners/${partnerId}`,
    );
    return data.data;
  },
};
