/**
 * The premium light scheme — the mobile app's second skin.
 *
 * Same shape as `premium.ts`'s dark scheme (`background`, `brand`,
 * `gradients`, `glass`, `card`, `glow`), so a screen that destructures
 * `useTheme().premium` or `useTheme().glass` works identically under either
 * theme without knowing which one is active. Only the values change:
 *
 * - The identity gradient moves from blue→violet to two steps of the
 *   product's real brand ramp (`brand` in `color.ts`) — the green the web
 *   dashboards already use, tuned by eye against the approved reference
 *   design (white ground, glossy green balance card, green primary button).
 * - "Glass" stops meaning a blur over near-black and starts meaning a
 *   near-white card with a soft, low-alpha shadow — the concept (a panel
 *   with substance and an edge) carries over, the values do not.
 * - The glow drops from a saturated neon blue to a quiet brand-tinted
 *   elevation shadow, because a glow that reads as "light spilling out" on
 *   black reads as a colour cast on white.
 *
 * Corners and heading weights are *not* redefined here — `premiumRadius` and
 * `premiumTextWeights` from `premium.ts` are shape/weight tokens, not
 * colours, and the rounder, glossier feel they carry is exactly what the
 * light reference design wants too. `index.ts` reuses them as-is when it
 * assembles `tutakMobileLightTheme`.
 */

import { neutral, brand, available, pending, reserved } from './color';

/**
 * Ground and the surfaces stacked on it, for the map component only (see
 * `TileMap.tsx`). `base` is painted under a low-opacity scrim meant to darken
 * an OSM basemap for a dark UI; on a light UI the basemap is already the
 * right brightness, so `base` is transparent and the scrim becomes a no-op
 * without any per-theme branch in the map component itself.
 */
export const lightPremiumBackground = {
  base: 'transparent',
  secondary: neutral[100],
  tertiary: neutral[50],
} as const;

/** The identity colour, at the same three steps the dark scheme exposes. */
export const lightPremiumBrand = {
  primary: brand[600],
  light: brand[400],
  dark: brand[800],
  violet: brand[300],
} as const;

export const lightPremiumGradients = {
  /** Primary actions, the balance card, avatars — two steps of the brand ramp. */
  primary: [brand[400], brand[700]] as const,
  /** Reserved for warm, secondary emphasis — referral rewards, promotions.
   *  Unchanged from the dark scheme: a coral→amber pair reads the same way
   *  regardless of what surface it sits on. */
  secondary: ['#FF6B6B', '#FFB347'] as const,
} as const;

/**
 * Glass, light-surface version. `background` is a barely-there ink wash
 * rather than a white wash — on a white ground, translucent *white* is
 * invisible, so the panel has to be a faint tint of the darkest colour on
 * screen instead. `dark` is the exception: it backs the map's attribution
 * chip, which sits on top of photographic tiles rather than the app's own
 * ground, so it stays a near-opaque light chip the way the dark scheme's
 * `dark` stays a near-opaque dark one.
 */
export const lightPremiumGlass = {
  background: 'rgba(16, 24, 40, 0.04)',
  light: 'rgba(16, 24, 40, 0.06)',
  dark: 'rgba(255, 255, 255, 0.82)',
  border: 'rgba(16, 24, 40, 0.08)',
} as const;

export const lightPremiumCard = {
  background: neutral[0],
  hover: neutral[50],
  border: neutral[200],
} as const;

/**
 * Shadow, not glow. On white, depth comes from a conventional soft shadow
 * pooling under the element — the dark scheme's "light spills outward"
 * reasoning inverts once the ground is bright. Kept faintly brand-tinted
 * rather than flat grey, which is what keeps a card feel "premium" rather
 * than merely elevated.
 */
export const lightPremiumGlow = {
  sm: {
    web: '0 2px 8px rgba(11, 93, 59, 0.10)',
    native: {
      shadowColor: lightPremiumBrand.primary,
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
  },
  md: {
    web: '0 6px 16px rgba(11, 93, 59, 0.14)',
    native: {
      shadowColor: lightPremiumBrand.primary,
      shadowOpacity: 0.14,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
  },
  lg: {
    web: '0 12px 28px rgba(11, 93, 59, 0.18)',
    native: {
      shadowColor: lightPremiumBrand.primary,
      shadowOpacity: 0.18,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  },
} as const;

/**
 * Bonus-state hues with a `border` added, so this matches the *shape* of
 * `premiumBonusStateColors` (which the mobile `StatePill` component reads a
 * `.border` off of) while carrying the exact `fill`/`text`/`surface` values
 * `bonusStateColors` in `color.ts` already defines — this is not a new
 * palette, just that one plus the missing key.
 */
const lightStateAvailable = {
  fill: available[500],
  text: available[700],
  surface: available[50],
  border: available[200],
} as const;

const lightStatePending = {
  fill: pending[500],
  text: pending[700],
  surface: pending[50],
  border: pending[200],
} as const;

const lightStateReserved = {
  fill: reserved[500],
  text: reserved[700],
  surface: reserved[50],
  border: reserved[200],
} as const;

export const lightPremiumBonusStateColors = {
  available: lightStateAvailable,
  pending: lightStatePending,
  reserved: lightStateReserved,
} as const;

/**
 * Which `expo-blur` tint reads correctly. `Surface` and `HomeHeader` both
 * pass this straight to `<BlurView tint={...}>` on iOS instead of hardcoding
 * `"dark"` — the one place a component would otherwise need to know which
 * theme is active, folded into a token instead.
 */
export const lightPremiumBlurTint = 'light' as const;

/** Everything the light scheme adds on top of the shared token set. */
export const lightPremium = {
  background: lightPremiumBackground,
  brand: lightPremiumBrand,
  gradients: lightPremiumGradients,
  glass: lightPremiumGlass,
  card: lightPremiumCard,
  glow: lightPremiumGlow,
  blurTint: lightPremiumBlurTint,
} as const;
