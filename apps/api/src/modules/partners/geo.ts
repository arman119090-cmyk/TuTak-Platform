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
}

/** Mean radius of the Earth, in kilometres. */
const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Straight-line distance between two points on the globe, in kilometres.
 *
 * Haversine rather than the flat-earth approximation the bounding box uses.
 * The box is there to make the database do less work; this decides what the
 * customer is actually told, and "1.4 km" being wrong by a few hundred metres
 * because the maths assumed a plane is the kind of thing somebody notices when
 * they walk it.
 *
 * Rounded to one decimal because that is the precision a person can act on.
 * Two would be false confidence: the branch's own coordinate is a pin someone
 * dropped on a building, not a doorway.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  return Math.round(EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
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
  const value = (raw ?? '').trim().toLowerCase();
  return KNOWN.has(value) ? (value as PartnerCategory) : 'other';
}
