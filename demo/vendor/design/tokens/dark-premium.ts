/**
 * The premium dark scheme — the mobile app's night skin.
 *
 * The *same product* as `light-premium.ts` with the lights off: the brand
 * stays TuTak green, the hero card keeps its green gradient, the three
 * bonus states keep their hues. Only the ground and the greys invert. This
 * is deliberately not `premium.ts`, which is the legacy blue/violet dark
 * shell the v1 app shipped with — a customer who flips the switch in
 * Settings must get TuTak in the dark, not a different app.
 *
 * Same shape as `light-premium.ts`, key for key, so a screen that reads
 * `useTheme().premium` or `useTheme().glass` works under either theme with
 * no branch. The values follow three rules:
 *
 * - The ground is ink, not black. `neutral.ink` (#0A0D14) is the darkest
 *   step of the same neutral ramp the light scheme uses, so the two themes
 *   are the one palette read from opposite ends. Pure #000 makes every
 *   card look like a hole.
 * - Surfaces get *lighter* as they come forward (card above ground, raised
 *   above card) — the opposite of the light scheme, where depth is a shadow
 *   pooling under a white card. On a dark ground a shadow is invisible, so
 *   elevation has to be tonal.
 * - Text and fills step down the ramps, not up: `brand[500]` for a primary
 *   button (the light scheme's `brand[600]` is too dark against ink), and
 *   the 300/400 steps of each state hue for text, where the light scheme
 *   uses 700.
 */

import { neutral, brand, available, pending, reserved, danger } from './color';

/** The ground and the two tones stacked on it. */
export const darkPremiumBackground = {
  /**
   * Painted over the map's tiles only (see `TileMap.tsx`): an OSM basemap is
   * light, and a bright rectangle in a dark UI reads as a broken image. The
   * light scheme sets this transparent, so the same scrim element is a
   * no-op there.
   */
  base: 'rgba(6, 10, 16, 0.45)',
  secondary: '#151A22',
  tertiary: '#1B212B',
} as const;

/** The identity colour, lifted one step so it carries on ink. */
export const darkPremiumBrand = {
  primary: brand[500],
  light: brand[300],
  dark: brand[700],
  violet: brand[200],
} as const;

export const darkPremiumGradients = {
  /** The hero card. The same two greens as the light scheme: the card is
   *  the one thing that should look identical in both — it is the brand. */
  primary: [brand[500], brand[700]] as const,
  secondary: ['#FF6B6B', '#FFB347'] as const,
} as const;

/**
 * Glass, dark-surface version. `background`/`light` are faint white washes —
 * on ink, translucent white is what reads as a panel. `dark` backs the map's
 * attribution chip over photographic tiles, so it stays a near-opaque dark
 * chip regardless of theme.
 */
export const darkPremiumGlass = {
  background: 'rgba(255, 255, 255, 0.05)',
  light: 'rgba(255, 255, 255, 0.08)',
  dark: 'rgba(10, 13, 20, 0.78)',
  border: 'rgba(255, 255, 255, 0.10)',
} as const;

export const darkPremiumCard = {
  background: '#151A22',
  hover: '#1B212B',
  border: '#262D37',
} as const;

/**
 * Shadows are kept — Android draws `elevation` regardless and iOS needs the
 * keys — but at opacities that stay quiet: on ink a strong shadow is a
 * black smear. Depth here comes from the card being lighter than the
 * ground, not from what is under it.
 */
export const darkPremiumGlow = {
  sm: {
    web: '0 1px 2px rgba(0, 0, 0, 0.30), 0 4px 12px rgba(0, 0, 0, 0.35)',
    native: {
      shadowColor: '#000000',
      shadowOpacity: 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 1,
    },
  },
  md: {
    web: '0 2px 4px rgba(0, 0, 0, 0.30), 0 12px 28px rgba(0, 0, 0, 0.45)',
    native: {
      shadowColor: '#000000',
      shadowOpacity: 0.45,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
  },
  lg: {
    web: '0 4px 8px rgba(0, 0, 0, 0.30), 0 20px 40px rgba(0, 0, 0, 0.55)',
    native: {
      shadowColor: '#000000',
      shadowOpacity: 0.55,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 12 },
      elevation: 6,
    },
  },
} as const;

/**
 * Bonus-state hues on ink. `fill` steps down to 400 so a dot or bar is not
 * a neon spot; `text` is the 300 step, which reaches contrast on the dark
 * ground the way 700 does on white; `surface`/`border` are the 500 hue at
 * low alpha — a solid pale tint would punch a hole in the dark UI.
 * `#RRGGBBAA` is what React Native and every browser accept.
 */
const darkStateAvailable = {
  fill: available[400],
  text: available[300],
  surface: `${available[500]}24`,
  border: `${available[500]}4D`,
} as const;

const darkStatePending = {
  fill: pending[400],
  text: pending[300],
  surface: `${pending[500]}24`,
  border: `${pending[500]}4D`,
} as const;

const darkStateReserved = {
  fill: reserved[400],
  text: reserved[300],
  surface: `${reserved[500]}24`,
  border: `${reserved[500]}4D`,
} as const;

export const darkPremiumBonusStateColors = {
  available: darkStateAvailable,
  pending: darkStatePending,
  reserved: darkStateReserved,
} as const;

/**
 * Semantic aliases for the dark scheme. Same keys as `semantic` in
 * `color.ts` (plus `textMuted`, which the mobile theme shape carries), so
 * `color.textSecondary` means "secondary text" under either theme.
 */
export const darkSemantic = {
  // Surfaces
  background: neutral.ink,
  backgroundSubtle: '#11161D',
  surface: darkPremiumCard.background,
  surfaceRaised: darkPremiumBackground.tertiary,
  surfaceSunken: '#11161D',
  overlay: 'rgba(0, 0, 0, 0.60)',
  divider: '#1F2630',
  fillSubtle: '#1B212B',
  fillSubtlePressed: '#242C37',

  // Lines
  border: darkPremiumCard.border,
  borderStrong: '#343C48',
  borderFocus: brand[400],

  // Text
  textPrimary: '#F4F6F8',
  textSecondary: neutral[400],
  textTertiary: neutral[500],
  textMuted: neutral[600],
  textInverse: neutral[0],
  textBrand: brand[300],

  // Interactive
  primary: brand[500],
  primaryHover: brand[400],
  primaryPressed: brand[600],
  primarySurface: `${brand[500]}2E`,

  // Bonus states
  availableFill: darkStateAvailable.fill,
  availableText: darkStateAvailable.text,
  availableSurface: darkStateAvailable.surface,

  pendingFill: darkStatePending.fill,
  pendingText: darkStatePending.text,
  pendingSurface: darkStatePending.surface,

  reservedFill: darkStateReserved.fill,
  reservedText: darkStateReserved.text,
  reservedSurface: darkStateReserved.surface,

  dangerFill: danger[400],
  dangerText: danger[300],
  dangerSurface: `${danger[500]}24`,
} as const;

/** Which `expo-blur` tint reads correctly on ink. */
export const darkPremiumBlurTint = 'dark' as const;

/** Everything the dark scheme adds on top of the shared token set. */
export const darkPremium = {
  background: darkPremiumBackground,
  brand: darkPremiumBrand,
  gradients: darkPremiumGradients,
  glass: darkPremiumGlass,
  card: darkPremiumCard,
  glow: darkPremiumGlow,
  blurTint: darkPremiumBlurTint,
} as const;
