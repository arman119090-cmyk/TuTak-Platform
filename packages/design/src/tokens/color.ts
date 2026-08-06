/**
 * TuTak colour system.
 *
 * Three ideas govern everything here:
 *
 * 1. White is the product. Surfaces are white or near-white; colour is spent
 *    only where it carries meaning. Nothing is tinted "for style".
 * 2. The three bonus states are the brand. Green = available/active,
 *    amber = pending, blue = reserved. These hues are reserved exclusively
 *    for bonus state — never reused for generic UI accents — so a colour
 *    always means the same thing on every screen of every app.
 * 3. Neutral grey carries all secondary information, and is also Jako's own
 *    plumage — the African Grey is literally a grey bird, so the neutral
 *    ramp doubles as the brand's mascot palette.
 *
 * Every ramp is 25→900. Use 500/600 for fills and icons, 700+ for text on
 * light backgrounds (500-level hues do not reach 4.5:1 on white), and
 * 25/50 for the tinted surfaces behind state content.
 */

export const neutral = {
  0: '#FFFFFF',
  25: '#FCFCFD',
  50: '#F8F9FB',
  100: '#F1F3F6',
  200: '#E4E7EC',
  300: '#D0D5DD',
  400: '#98A2B3',
  500: '#667085',
  600: '#475467',
  700: '#344054',
  800: '#1D2939',
  900: '#101828',
  ink: '#0A0D14',
} as const;

/** Deep TuTak green. Identity colour — logo, primary actions, focus. */
export const brand = {
  25: '#F2FBF6',
  50: '#E6F5EC',
  100: '#C4E8D4',
  200: '#96D5B4',
  300: '#5FBC90',
  400: '#2E9C6E',
  500: '#10794F',
  600: '#0B5D3B', // core brand green
  700: '#094D31',
  800: '#073C26',
  900: '#052B1B',
} as const;

/** AVAILABLE bonus — spendable right now. The "go" state. */
export const available = {
  25: '#F6FEF9',
  50: '#ECFDF3',
  100: '#D1FADF',
  200: '#A6F4C5',
  300: '#6CE9A6',
  400: '#32D583',
  500: '#12B76A',
  600: '#039855',
  700: '#027A48',
  800: '#05603A',
  900: '#054F31',
} as const;

/** PENDING bonus — accrued but still inside its cooling-off window. */
export const pending = {
  25: '#FFFCF5',
  50: '#FFFAEB',
  100: '#FEF0C7',
  200: '#FEDF89',
  300: '#FEC84B',
  400: '#FDB022',
  500: '#F79009',
  600: '#DC6803',
  700: '#B54708',
  800: '#93370D',
  900: '#7A2E0E',
} as const;

/** RESERVED bonus — held against an in-flight payment or charging session. */
export const reserved = {
  25: '#F5FAFF',
  50: '#EFF8FF',
  100: '#D1E9FF',
  200: '#B2DDFF',
  300: '#84CAFF',
  400: '#53B1FD',
  500: '#2E90FA',
  600: '#1570EF',
  700: '#175CD3',
  800: '#1849A9',
  900: '#194185',
} as const;

/** Destructive actions and failures only. Never a bonus state. */
export const danger = {
  25: '#FFFBFA',
  50: '#FEF3F2',
  100: '#FEE4E2',
  200: '#FECDCA',
  300: '#FDA29B',
  400: '#F97066',
  500: '#F04438',
  600: '#D92D20',
  700: '#B42318',
  800: '#912018',
  900: '#7A271A',
} as const;

export const palette = { neutral, brand, available, pending, reserved, danger } as const;

/**
 * Semantic aliases. Screens should reference these, not raw ramp steps, so
 * meaning stays consistent and a single edit re-tunes every surface.
 */
export const semantic = {
  // Surfaces
  background: neutral[0],
  backgroundSubtle: neutral[50],
  surface: neutral[0],
  surfaceRaised: neutral[0],
  surfaceSunken: neutral[50],
  overlay: 'rgba(16, 24, 40, 0.48)',

  // Lines
  border: neutral[200],
  borderStrong: neutral[300],
  borderFocus: brand[600],

  // Text
  textPrimary: neutral[900],
  textSecondary: neutral[500],
  textTertiary: neutral[400],
  textInverse: neutral[0],
  textBrand: brand[600],

  // Interactive
  primary: brand[600],
  primaryHover: brand[700],
  primaryPressed: brand[800],
  primarySurface: brand[50],

  // Bonus states — fill (dots, bars, icons) and text (accessible on white)
  availableFill: available[500],
  availableText: available[700],
  availableSurface: available[50],

  pendingFill: pending[500],
  pendingText: pending[700],
  pendingSurface: pending[50],

  reservedFill: reserved[500],
  reservedText: reserved[700],
  reservedSurface: reserved[50],

  dangerFill: danger[500],
  dangerText: danger[700],
  dangerSurface: danger[50],
} as const;

export type BonusState = 'available' | 'pending' | 'reserved';

/** Single lookup used by every bonus visualisation across all three apps. */
export const bonusStateColors: Record<
  BonusState,
  { fill: string; text: string; surface: string }
> = {
  available: {
    fill: semantic.availableFill,
    text: semantic.availableText,
    surface: semantic.availableSurface,
  },
  pending: {
    fill: semantic.pendingFill,
    text: semantic.pendingText,
    surface: semantic.pendingSurface,
  },
  reserved: {
    fill: semantic.reservedFill,
    text: semantic.reservedText,
    surface: semantic.reservedSurface,
  },
};
