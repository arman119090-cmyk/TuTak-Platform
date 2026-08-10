import type { Ionicons } from '@expo/vector-icons';
import { PartnerCategory } from '@tutak/shared-types';

/**
 * The icon and chip order for each category a partner can belong to.
 *
 * Order is deliberate rather than alphabetical or enum order: the chips are a
 * horizontal strip and only three or four fit without scrolling, so the ones
 * people look for daily come first. `OTHER` is last because it is where
 * anything unrecognised lands — see `toPartnerCategory` on the server.
 *
 * The list is exhaustive over the enum by construction (`Record<...>`), so
 * adding a category to `@tutak/shared-types` fails the mobile typecheck until
 * it has an icon here. That is the intent: the server's fallback keeps a new
 * category *drawable*, and this keeps it from silently arriving as a generic
 * pin nobody chose.
 */
export const CATEGORY_ICONS: Record<PartnerCategory, keyof typeof Ionicons.glyphMap> = {
  [PartnerCategory.GROCERY]: 'basket-outline',
  [PartnerCategory.CAFE]: 'cafe-outline',
  [PartnerCategory.RESTAURANT]: 'restaurant-outline',
  [PartnerCategory.PHARMACY]: 'medkit-outline',
  [PartnerCategory.FUEL]: 'car-outline',
  [PartnerCategory.EV_CHARGING]: 'flash-outline',
  [PartnerCategory.BEAUTY]: 'cut-outline',
  [PartnerCategory.OTHER]: 'storefront-outline',
};

/** Chip order, left to right. */
export const CATEGORY_ORDER: PartnerCategory[] = [
  PartnerCategory.GROCERY,
  PartnerCategory.CAFE,
  PartnerCategory.RESTAURANT,
  PartnerCategory.PHARMACY,
  PartnerCategory.FUEL,
  PartnerCategory.EV_CHARGING,
  PartnerCategory.BEAUTY,
  PartnerCategory.OTHER,
];

/**
 * A distance a person can act on.
 *
 * Under a kilometre it is metres, rounded to the nearest ten — "460 м" is a
 * walk, "0.5 км" is an abstraction. Above it, one decimal, which is the
 * precision the server sends and the most a straight-line distance can honestly
 * claim: the real walk is longer and nobody knows by how much.
 */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} м`;
  return `${km.toFixed(1)} км`;
}
