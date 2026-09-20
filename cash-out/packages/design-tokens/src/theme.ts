import { palette } from './palette';

/**
 * Semantic colour roles.
 *
 * A screen never says "jade 600"; it says "the primary action's background".
 * Swapping the palette, adding a dark theme or meeting a contrast requirement
 * then happens in this one file instead of across forty components.
 */
export interface ThemeColors {
  readonly background: string;
  readonly backgroundElevated: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly surfaceInverse: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly textInverse: string;
  readonly primary: string;
  readonly primaryPressed: string;
  readonly primaryDisabled: string;
  readonly onPrimary: string;
  readonly primarySoft: string;
  readonly success: string;
  readonly successSoft: string;
  readonly warning: string;
  readonly warningSoft: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly info: string;
  readonly infoSoft: string;
  readonly focusRing: string;
  readonly skeleton: string;
  readonly overlay: string;
}

export const lightColors: ThemeColors = {
  background: palette.paper[50],
  backgroundElevated: palette.paper[0],
  surface: palette.paper[0],
  surfaceMuted: palette.paper[100],
  surfaceInverse: palette.ink[950],
  border: palette.paper[200],
  borderStrong: palette.paper[300],
  textPrimary: palette.ink[950],
  textSecondary: palette.ink[500],
  textTertiary: palette.ink[300],
  textInverse: palette.ink[0],
  primary: palette.emerald[600],
  primaryPressed: palette.emerald[700],
  primaryDisabled: palette.emerald[200],
  onPrimary: palette.ink[0],
  primarySoft: palette.emerald[50],
  success: palette.emerald[600],
  successSoft: palette.emerald[50],
  warning: palette.amber[600],
  warningSoft: palette.amber[50],
  danger: palette.crimson[600],
  dangerSoft: palette.crimson[50],
  info: palette.sapphire[600],
  infoSoft: palette.sapphire[50],
  focusRing: palette.emerald[400],
  skeleton: palette.paper[200],
  overlay: 'rgba(10, 19, 34, 0.55)',
};

/**
 * Dark is a first-class theme, not an inversion: navy canvas, a lighter navy
 * surface, and the emerald lifted two steps so it reads as text on navy. The
 * primary button keeps a deep-emerald label on the lifted emerald, which is
 * the pairing that clears AA (the contrast tests hold it there).
 */
export const darkColors: ThemeColors = {
  background: palette.ink[900],
  backgroundElevated: palette.ink[850],
  surface: palette.ink[850],
  surfaceMuted: palette.ink[800],
  surfaceInverse: palette.ink[50],
  border: palette.ink[750],
  borderStrong: palette.ink[700],
  textPrimary: palette.ink[50],
  textSecondary: palette.ink[200],
  textTertiary: palette.ink[400],
  textInverse: palette.ink[950],
  primary: palette.emerald[400],
  primaryPressed: palette.emerald[300],
  primaryDisabled: palette.emerald[800],
  onPrimary: palette.emerald[900],
  primarySoft: '#0F3A31',
  success: palette.emerald[300],
  successSoft: '#0F3A31',
  warning: palette.amber[300],
  warningSoft: palette.amber[900],
  danger: palette.crimson[300],
  dangerSoft: palette.crimson[900],
  info: palette.sapphire[300],
  infoSoft: palette.sapphire[900],
  focusRing: palette.emerald[300],
  skeleton: palette.ink[750],
  overlay: 'rgba(0, 0, 0, 0.66)',
};

/** 4pt grid. Every margin and padding in the product is one of these. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  giant: 64,
} as const;

/**
 * Radii from the design system: cards at 28, controls (buttons, fields,
 * segments) at 18. `xl` remains for sheets' inner elements and dialogs.
 */
export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  control: 18,
  xl: 20,
  card: 28,
  xxl: 28,
  pill: 999,
} as const;

/**
 * Type scale.
 *
 * `amount` sizes are deliberately enormous: the balance and the payout total are
 * the two numbers a driver checks at arm's length, one-handed, often in a moving
 * car. Everything else is secondary to those two being unmistakable.
 */
export const typography = {
  amountHero: { fontSize: 48, lineHeight: 54, fontWeight: '700', letterSpacing: -1.2 },
  amountLarge: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -0.8 },
  amountMedium: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.4 },
  titleLarge: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.2 },
  bodyLarge: { fontSize: 17, lineHeight: 24, fontWeight: '500', letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', letterSpacing: 0 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0 },
  micro: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.4 },
} as const;

/**
 * Tap targets. The design system's floor is 48, above the platform minimum
 * of 44; the primary CTA sits in the 54–58 band, because the main flow is used
 * with gloves on, in the cold, without looking.
 */
export const touchTarget = {
  minimum: 48,
  comfortable: 52,
  primaryAction: 56,
} as const;

export const elevation = {
  none: { shadowOpacity: 0, shadowRadius: 0, elevation: 0, shadowOffset: { width: 0, height: 0 } },
  card: {
    shadowColor: '#0A1322',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
    shadowOffset: { width: 0, height: 4 },
  },
  sheet: {
    shadowColor: '#0A1322',
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 12,
    shadowOffset: { width: 0, height: -8 },
  },
} as const;

export const motion = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 320,
} as const;

/** Breakpoints in device-independent pixels, for the admin panel and tablets. */
export const breakpoints = {
  /** Small phones — iPhone SE, budget Androids. The layout must survive here. */
  xs: 320,
  sm: 375,
  md: 480,
  lg: 768,
  xl: 1024,
  xxl: 1280,
} as const;

export type ThemeName = 'light' | 'dark';

export interface Theme {
  readonly name: ThemeName;
  readonly colors: ThemeColors;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
  readonly touchTarget: typeof touchTarget;
  readonly elevation: typeof elevation;
  readonly motion: typeof motion;
}

export const lightTheme: Theme = {
  name: 'light',
  colors: lightColors,
  spacing,
  radius,
  typography,
  touchTarget,
  elevation,
  motion,
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: darkColors,
  spacing,
  radius,
  typography,
  touchTarget,
  elevation,
  motion,
};

export const themes: Record<ThemeName, Theme> = { light: lightTheme, dark: darkTheme };
