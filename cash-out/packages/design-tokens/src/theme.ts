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
  background: palette.ink[25],
  backgroundElevated: palette.ink[0],
  surface: palette.ink[0],
  surfaceMuted: palette.ink[50],
  surfaceInverse: palette.ink[900],
  border: palette.ink[100],
  borderStrong: palette.ink[200],
  textPrimary: palette.ink[900],
  textSecondary: palette.ink[500],
  textTertiary: palette.ink[400],
  textInverse: palette.ink[0],
  primary: palette.jade[600],
  primaryPressed: palette.jade[700],
  primaryDisabled: palette.jade[200],
  onPrimary: palette.ink[0],
  primarySoft: palette.jade[50],
  success: palette.jade[600],
  successSoft: palette.jade[50],
  warning: palette.amber[600],
  warningSoft: palette.amber[50],
  danger: palette.crimson[600],
  dangerSoft: palette.crimson[50],
  info: palette.sapphire[600],
  infoSoft: palette.sapphire[50],
  focusRing: palette.jade[400],
  skeleton: palette.ink[100],
  overlay: 'rgba(14, 18, 17, 0.55)',
};

/**
 * Present from the start so that components are written against roles rather
 * than against light-theme hex values. The product ships light-first; this
 * exists so that shipping dark later is a switch, not a rewrite.
 */
export const darkColors: ThemeColors = {
  background: palette.ink[900],
  backgroundElevated: palette.ink[800],
  surface: palette.ink[800],
  surfaceMuted: palette.ink[700],
  surfaceInverse: palette.ink[0],
  border: palette.ink[700],
  borderStrong: palette.ink[600],
  textPrimary: palette.ink[25],
  textSecondary: palette.ink[300],
  textTertiary: palette.ink[400],
  textInverse: palette.ink[900],
  primary: palette.jade[400],
  primaryPressed: palette.jade[300],
  primaryDisabled: palette.jade[800],
  onPrimary: palette.ink[900],
  primarySoft: palette.jade[900],
  success: palette.jade[400],
  successSoft: palette.jade[900],
  warning: palette.amber[100],
  warningSoft: palette.amber[700],
  danger: palette.crimson[100],
  dangerSoft: palette.crimson[700],
  info: palette.sapphire[100],
  infoSoft: palette.sapphire[700],
  focusRing: palette.jade[300],
  skeleton: palette.ink[700],
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

export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
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
 * Minimum tap target. 56 rather than the platform minimum of 44: the primary
 * flow is used with gloves on, in the cold, without looking.
 */
export const touchTarget = {
  minimum: 44,
  comfortable: 56,
  primaryAction: 60,
} as const;

export const elevation = {
  none: { shadowOpacity: 0, shadowRadius: 0, elevation: 0, shadowOffset: { width: 0, height: 0 } },
  card: {
    shadowColor: '#0E1211',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
    shadowOffset: { width: 0, height: 4 },
  },
  sheet: {
    shadowColor: '#0E1211',
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
