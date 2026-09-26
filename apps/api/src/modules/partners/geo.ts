import type { MediaImageDto } from '../media/media.contracts';

export { haversineKm } from '../../common/utils/geo';

/**
 * The categories a customer's app can draw.
 *
 * Declared here rather than imported from `@tutak/shared-types`, because the
 * API's `rootDir` is its own `src` and importing across the workspace breaks
 * its build — every other module in this app follows the same rule. The
 * client's copy lives in `packages/shared-types/src/dto/partner.ts`.
 *
 * Two copies of one list is exactly the drift that has bitten this codebase
 * before, so `vocabulary-drift.spec.ts` asserts they are identical in both
 * directions. If you add one here, that test tells you where the other is.
 */
export const PARTNER_CATEGORIES = [
  'grocery',
  'cafe',
  'restaurant',
  'pharmacy',
  'fuel',
  'ev_charging',
  'beauty',
  'other',
] as const;

export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

/**
 * The `fuel`-category sub-filter — "Газ" (propane and methane, counted as
 * one) vs "Бензин" (Arman, 2026-08-26). Mirrors `FuelType` in
 * `@tutak/shared-types` — same reason as `PARTNER_CATEGORIES` above.
 */
export const FUEL_TYPES = ['gas', 'petrol'] as const;

export type FuelType = (typeof FUEL_TYPES)[number];

/**
 * One pin on the customer's map. Mirrors `NearbyPartnerDto` in
 * `@tutak/shared-types` — same reason as the category list above.
 *
 * It lives here rather than beside the service that builds it because the
 * controller's return type is part of the module's public surface: a shape
 * declared inside `partners.service.ts` and not exported cannot be named by
 * the declaration file TypeScript emits for the controller (TS4053).
 *
 * What is *not* on it is the point. No tax ID, no commission rate, no
 * settlement terms, no contact — a customer's map needs what is on the shop's
 * sign and nothing behind the counter. `listPublic` draws the same line for
 * the directory; this is that line applied to geography.
 */
export interface NearbyPartner {
  id: string;
  partnerId: string;
  name: string;
  branchName: string;
  category: PartnerCategory;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  cashbackPercent: number;
  distanceKm: number;
  /**
   * The chain's published logo/cover — spec §1.3's "catalogue/map card".
   *
   * Per *partner*, not per branch: four shops of one chain are four pins with
   * one identity, and a branch has no brand of its own. Null when the partner
   * has published none, which is every partner that predates the media system
   * — the client renders the neutral mark, never a broken image.
   */
  logo: MediaImageDto | null;
  cover: MediaImageDto | null;
  /** See `NearbyPartnerDto.sellsGas`/`sellsPetrol` in `@tutak/shared-types`. */
  sellsGas: boolean;
  sellsPetrol: boolean;
  /** See `NearbyPartnerDto.recommended` in `@tutak/shared-types`. */
  recommended: boolean;
}

const KNOWN = new Set<string>(PARTNER_CATEGORIES);

/**
 * The category a customer's app can draw, from whatever the database holds.
 *
 * `Partner.category` is a free-text column — it predates there being a filter
 * chip and an icon per category, and widening it to an enum is a migration
 * against live rows. Until then this is the seam: anything unrecognised
 * becomes `OTHER`, which has an icon and a chip of its own.
 *
 * The alternative, passing the raw string through, puts the client in the
 * position of rendering a pin for a category it has never heard of — and the
 * client's answer to that is a blank. A customer-visible value should never
 * come out of the database unlabelled; that is F-17, and it shipped once
 * already.
 */
export function toPartnerCategory(raw: string | null | undefined): PartnerCategory {
  const value = canonicalPartnerCategory(raw);
  return KNOWN.has(value) ? (value as PartnerCategory) : 'other';
}

/**
 * What to *store* in `Partner.category` — the write-side counterpart of
 * `toPartnerCategory` above.
 *
 * These two used to disagree, and that was a bug a customer could see. Reads
 * trimmed and lowercased; the map's filter did neither, matching the raw
 * column exactly. A restaurant stored as `"Restaurant"` — the capital letter
 * its own owner typed into the application form — therefore drew a restaurant
 * pin and was invisible to the restaurant chip, and nothing in any panel
 * could fix it: the category is not editable after the application, so it
 * took someone with a SQL prompt.
 *
 * Canonicalising here makes the stored value the one the reader already
 * assumes. Unknown values are *kept*, lowercased, rather than being collapsed
 * to `other`: `toPartnerCategory` already draws them as `other`, and throwing
 * away what the business actually called itself would lose the only record of
 * it — a category worth adding to the list above is found by reading these,
 * not by having rewritten them.
 */
export function canonicalPartnerCategory(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

/**
 * The categories that are *not* `other` — what the `other` chip has to
 * exclude, rather than match.
 *
 * `other` is the one chip whose meaning cannot be a column comparison. It is
 * defined by `toPartnerCategory` as "none of the recognised ones", so a
 * partner stored as `retail` is drawn under it; filtering `category: 'other'`
 * against the column found only partners whose category is literally the
 * string `other`, and returned nothing for every card the chip was showing.
 */
export const NAMED_PARTNER_CATEGORIES: readonly string[] = PARTNER_CATEGORIES.filter(
  (c) => c !== 'other',
);
