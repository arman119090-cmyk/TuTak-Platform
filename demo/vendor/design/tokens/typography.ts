/**
 * Type system.
 *
 * One family, tight scale, few weights. Money is the loudest thing on any
 * TuTak screen; everything else recedes. Numerals are always tabular so
 * balances don't shimmy as digits change.
 */

export const fontFamily = {
  /** Native system stack — SF on iOS/macOS, Roboto on Android, Segoe on Windows. */
  sans: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /** Used for tokens, IDs and raw payloads in the dashboards. */
  mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Scale. `display` sizes are for balances only — one per screen, at most.
 * Line heights are unitless-equivalent pixel values for React Native parity.
 */
export const fontSize = {
  display2xl: 56,
  displayXl: 44,
  displayLg: 36,
  displayMd: 30,
  displaySm: 26,
  xl: 22,
  lg: 19,
  md: 17,
  sm: 15,
  xs: 13,
  xxs: 11,
} as const;

export const lineHeight = {
  display2xl: 62,
  displayXl: 50,
  displayLg: 42,
  displayMd: 38,
  displaySm: 32,
  xl: 30,
  lg: 26,
  md: 24,
  sm: 22,
  xs: 18,
  xxs: 16,
} as const;

export const letterSpacing = {
  /** Large type needs negative tracking to feel set rather than typed. */
  tighter: -1.2,
  tight: -0.6,
  snug: -0.2,
  normal: 0,
  wide: 0.4,
  /** Uppercase micro-labels only. */
  caps: 0.8,
} as const;

type TextStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: string;
  letterSpacing: number;
};

export const textStyles = {
  /** Hero balance. Exactly one per screen. */
  balance: {
    fontSize: fontSize.display2xl,
    lineHeight: lineHeight.display2xl,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.tighter,
  },
  balanceSm: {
    fontSize: fontSize.displayMd,
    lineHeight: lineHeight.displayMd,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.tight,
  },
  titleLg: {
    fontSize: fontSize.displaySm,
    lineHeight: lineHeight.displaySm,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.tight,
  },
  title: {
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.snug,
  },
  headline: {
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.snug,
  },
  body: {
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.regular,
    letterSpacing: letterSpacing.normal,
  },
  bodySm: {
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: fontWeight.regular,
    letterSpacing: letterSpacing.normal,
  },
  label: {
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.normal,
  },
  caption: {
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.regular,
    letterSpacing: letterSpacing.normal,
  },
  /** Uppercase section eyebrow. Used sparingly. */
  overline: {
    fontSize: fontSize.xxs,
    lineHeight: lineHeight.xxs,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.caps,
  },
} satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof textStyles;
