/**
 * The premium dark scheme — the mobile app's skin.
 *
 * Ported from the `tutak-mobile-app` prototype, whose look is the one the
 * product is going with: a near-black ground, glass panels floating on it,
 * and a single blue→violet gradient carrying every primary action. Depth
 * comes from a blue-tinted glow rather than a grey drop shadow, which is
 * what stops a dark UI reading as flat.
 *
 * Only the phone uses this. The admin panel and the partner dashboard stay
 * on the light `semantic` set in `color.ts` — those are tools people read
 * spreadsheets in for an hour at a time, and this palette was designed for a
 * consumer app used in short bursts. Keeping the two apart is deliberate;
 * they share the spacing, radius and type scales, which is where consistency
 * actually matters.
 *
 * ── The one thing that could not be copied verbatim ──────────────────────
 *
 * The prototype has no bonus states. This product's entire model rests on
 * three of them — available, pending, reserved — and the rule that a colour
 * always means the same thing everywhere. The prototype's hues are reused
 * here rather than replaced: its green stays "available", its amber stays
 * "pending", and its own primary blue becomes "reserved", which is what the
 * light theme already used. Each is lifted toward the 300-level step,
 * because a 500-level hue that reads correctly on white is muddy on black.
 */

/** Ground and the surfaces stacked on it. */
export const premiumBackground = {
  base: '#0A0A0F',
  secondary: '#14141A',
  tertiary: '#1C1C24',
} as const;

/** The identity gradient. Every primary action wears it; nothing else does. */
export const premiumBrand = {
  primary: '#5B8CFF',
  light: '#7BA6FF',
  dark: '#3B6CDF',
  violet: '#A05BFF',
} as const;

export const premiumGradients = {
  /** Primary actions, the balance card, avatars. */
  primary: [premiumBrand.primary, premiumBrand.violet] as const,
  /** Reserved for warm, secondary emphasis — referral rewards, promotions. */
  secondary: ['#FF6B6B', '#FFB347'] as const,
} as const;

/**
 * Glass. `background` is the fill behind a blur; `border` is the hairline
 * that gives the panel an edge. Without the border the blur alone looks like
 * a smudge rather than a pane.
 */
export const premiumGlass = {
  background: 'rgba(255, 255, 255, 0.05)',
  light: 'rgba(255, 255, 255, 0.08)',
  dark: 'rgba(0, 0, 0, 0.30)',
  border: 'rgba(255, 255, 255, 0.10)',
} as const;

export const premiumCard = {
  background: 'rgba(20, 20, 26, 0.85)',
  hover: 'rgba(30, 30, 40, 0.90)',
  border: 'rgba(255, 255, 255, 0.08)',
} as const;

/**
 * Glow, not shadow. The colour is the brand blue: on a near-black ground a
 * grey shadow is invisible, so depth has to come from light spilling out of
 * the element rather than darkness pooling under it.
 */
export const premiumGlow = {
  sm: {
    web: '0 4px 16px rgba(91, 140, 255, 0.15)',
    native: {
      shadowColor: premiumBrand.primary,
      shadowOpacity: 0.15,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
  },
  md: {
    web: '0 8px 24px rgba(91, 140, 255, 0.25)',
    native: {
      shadowColor: premiumBrand.primary,
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
  },
  lg: {
    web: '0 12px 32px rgba(91, 140, 255, 0.35)',
    native: {
      shadowColor: premiumBrand.primary,
      shadowOpacity: 0.35,
      shadowRadius: 32,
      shadowOffset: { width: 0, height: 12 },
      elevation: 20,
    },
  },
} as const;

/**
 * Bonus-state hues, lifted for a dark ground.
 *
 * `fill` is for dots, bars and icons; `text` is what a label is set in;
 * `surface` is the tinted panel behind state content. On black the
 * relationship inverts from the light theme — `text` is *lighter* than
 * `fill`, and `surface` is a low-alpha wash of the hue rather than a pale
 * tint, because a solid pale panel would punch a hole in the dark UI.
 */
const stateAvailable = {
  fill: '#34C759',
  text: '#5FE787',
  surface: 'rgba(52, 199, 89, 0.12)',
  border: 'rgba(52, 199, 89, 0.28)',
} as const;

const statePending = {
  fill: '#FF9500',
  text: '#FFB84D',
  surface: 'rgba(255, 149, 0, 0.12)',
  border: 'rgba(255, 149, 0, 0.28)',
} as const;

const stateReserved = {
  fill: premiumBrand.primary,
  text: premiumBrand.light,
  surface: 'rgba(91, 140, 255, 0.12)',
  border: 'rgba(91, 140, 255, 0.28)',
} as const;

const stateDanger = {
  fill: '#FF3B30',
  text: '#FF7A72',
  surface: 'rgba(255, 59, 48, 0.12)',
  border: 'rgba(255, 59, 48, 0.28)',
} as const;

/**
 * Semantic aliases for the dark scheme. Same key names as the light
 * `semantic` set, so a component reads `color.textSecondary` and works under
 * either — which is what let the whole phone app be re-skinned without
 * touching a single screen's logic.
 */
export const premiumSemantic = {
  // Surfaces
  background: premiumBackground.base,
  backgroundSubtle: premiumBackground.secondary,
  surface: premiumCard.background,
  surfaceRaised: premiumBackground.tertiary,
  // "Sunken" inverts on a dark UI. Every use of this token is a small chip
  // or pill sitting *inside* a card — a timer, an icon tile, an unread dot's
  // backing — and a panel darker than the card it sits on is invisible at
  // that size. A faint wash of white is what reads as recessed here.
  surfaceSunken: premiumGlass.light,
  overlay: 'rgba(0, 0, 0, 0.72)',

  // Lines
  border: premiumCard.border,
  borderStrong: premiumGlass.border,
  borderFocus: premiumBrand.primary,

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#636366',
  textMuted: '#48484A',
  // On a dark UI the "inverse" of body text is still white, because the one
  // place it is used — labels on the gradient — sits on saturated blue.
  textInverse: '#FFFFFF',
  textBrand: premiumBrand.light,

  // Interactive
  primary: premiumBrand.primary,
  primaryHover: premiumBrand.light,
  primaryPressed: premiumBrand.dark,
  primarySurface: 'rgba(91, 140, 255, 0.12)',

  // Bonus states
  availableFill: stateAvailable.fill,
  availableText: stateAvailable.text,
  availableSurface: stateAvailable.surface,

  pendingFill: statePending.fill,
  pendingText: statePending.text,
  pendingSurface: statePending.surface,

  reservedFill: stateReserved.fill,
  reservedText: stateReserved.text,
  reservedSurface: stateReserved.surface,

  dangerFill: stateDanger.fill,
  dangerText: stateDanger.text,
  dangerSurface: stateDanger.surface,
} as const;

export const premiumBonusStateColors = {
  available: stateAvailable,
  pending: statePending,
  reserved: stateReserved,
} as const;

/**
 * Rounder corners than the light theme.
 *
 * The prototype's radii run 8 / 14 / 20 / 24 / 32, noticeably softer than
 * the 8 / 12 / 16 / 20 / 28 the dashboards use, and on a dark UI that
 * softness is most of what separates "premium" from "an app with the
 * lights off". Overridden here rather than in `layout.ts` so the dashboards
 * keep the corners they were designed with.
 */
export const premiumRadius = {
  none: 0,
  /** Icon tiles, chips, tags. */
  sm: 10,
  /** Controls: buttons, inputs, search. */
  md: 12,
  /** Cards, grouped lists, the spotlight card. */
  lg: 16,
  /** The hero only — one per screen. */
  xl: 20,
  /** Reserved for a full-bleed sheet; never a card, never a control. */
  '2xl': 24,
  full: 9999,
} as const;

/**
 * Heavier, tighter headings.
 *
 * The prototype sets titles at 700 with negative tracking; against a black
 * ground that weight is needed, because light text on dark optically
 * thickens and a 600 heading loses its edge. Only the heading styles change
 * — body, label and caption stay exactly as the shared scale defines them,
 * since that is what keeps long text readable.
 */
export const premiumTextWeights = {
  // Semibold, not bold, on the light ground: 700 was chosen for white-on-
  // black, where light text optically thins. On white the same weight
  // reads heavy and the tracking that came with it (-1 / -0.5) crushes
  // Armenian, whose glyphs sit wider than Latin. Tracking is kept gentle
  // enough to read as set type in all three languages.
  //
  // Sizes, where they differ from `textStyles`, are the phone's: the shared
  // scale was cut for dashboards on a 27" display, and a 26 pt page title on
  // a 390 pt phone read as a poster. 24 for the page title, 20 for a screen
  // title in a row, and the hero balance at 44 rather than 56 — the number
  // should dominate the card, not the screen, and 56 wrapped a six-digit
  // balance on a compact phone.
  balance: { fontSize: 44, lineHeight: 50, fontWeight: '600' as const, letterSpacing: -0.8 },
  balanceSm: { fontSize: 32, lineHeight: 38, fontWeight: '600' as const, letterSpacing: -0.5 },
  titleLg: { fontSize: 24, lineHeight: 30, fontWeight: '600' as const, letterSpacing: -0.3 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const, letterSpacing: -0.2 },
  headline: { fontWeight: '600' as const, letterSpacing: -0.1 },
} as const;

/**
 * Which `expo-blur` tint reads correctly on this scheme. `Surface` and
 * `HomeHeader` read this instead of hardcoding `tint="dark"`, so the one
 * place a shared component would otherwise need to know which theme is
 * active is a token lookup rather than a branch.
 */
export const premiumBlurTint = 'dark' as const;

/** Everything the dark scheme adds on top of the shared token set. */
export const premium = {
  background: premiumBackground,
  brand: premiumBrand,
  gradients: premiumGradients,
  glass: premiumGlass,
  card: premiumCard,
  glow: premiumGlow,
  blurTint: premiumBlurTint,
} as const;
