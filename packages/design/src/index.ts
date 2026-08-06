export * from './tokens/color';
export * from './tokens/typography';
export * from './tokens/layout';
export * from './tokens/motion';
export * from './brand/jako-paths';
export { buildCssVariables } from './css';

import { semantic, bonusStateColors, palette } from './tokens/color';
import { textStyles, fontFamily } from './tokens/typography';
import { space, radius, elevation, layout } from './tokens/layout';
import { duration, easing, springConfig } from './tokens/motion';

/** Convenience bundle for React Native's ThemeProvider. */
export const tutakTheme = {
  color: semantic,
  palette,
  bonusState: bonusStateColors,
  text: textStyles,
  fontFamily,
  space,
  radius,
  elevation,
  layout,
  motion: { duration, easing, springConfig },
} as const;

export type TutakTheme = typeof tutakTheme;

import { neutral, brand as brandRamp } from './tokens/color';
import type { JakoColors } from './brand/jako-paths';

/** Default Jako palette — the mark as it appears on white surfaces. */
export const jakoDefaultColors: JakoColors = {
  brand: brandRamp[600],
  body: neutral[400],
  crown: neutral[300],
  beak: neutral[700],
  beakShadow: neutral[800],
  scallops: '#B6BDC9',
  eyePatch: neutral[25],
  pupil: neutral[900],
  catchlight: neutral[0],
};
