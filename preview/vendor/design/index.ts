export * from './tokens/color';
export * from './tokens/typography';
export * from './tokens/layout';
export * from './tokens/motion';
export * from './tokens/premium';
export * from './brand/jako-paths';
export { buildCssVariables } from './css';

import { semantic, bonusStateColors, palette } from './tokens/color';
import { textStyles, fontFamily } from './tokens/typography';
import { space, radius, elevation, layout } from './tokens/layout';
import { duration, easing, springConfig } from './tokens/motion';
import {
  premium,
  premiumBonusStateColors,
  premiumGlow,
  premiumRadius,
  premiumSemantic,
  premiumTextWeights,
} from './tokens/premium';

/**
 * The heading styles with the dark scheme's weights folded in.
 *
 * Built here rather than duplicated in `premium.ts` so the sizes and line
 * heights stay owned by one file — only weight and tracking are overridden,
 * and a change to the scale still reaches both themes.
 */
const premiumTextStyles = {
  ...textStyles,
  balance: { ...textStyles.balance, ...premiumTextWeights.balance },
  balanceSm: { ...textStyles.balanceSm, ...premiumTextWeights.balanceSm },
  titleLg: { ...textStyles.titleLg, ...premiumTextWeights.titleLg },
  title: { ...textStyles.title, ...premiumTextWeights.title },
  headline: { ...textStyles.headline, ...premiumTextWeights.headline },
} as const;

/**
 * The phone's theme: the premium dark scheme.
 *
 * Consumed only by the React Native app. The dashboards read the light
 * `semantic` tokens through CSS variables and are unaffected by anything
 * here — see the note at the top of `tokens/premium.ts` for why the two
 * surfaces are deliberately different.
 *
 * `elevation` still carries the light theme's grey shadows because a few
 * shared components reference it; `glow` is what the dark UI actually uses,
 * and every restyled component reaches for that instead.
 */
export const tutakTheme = {
  color: premiumSemantic,
  palette,
  premium,
  gradients: premium.gradients,
  glass: premium.glass,
  glow: premiumGlow,
  bonusState: premiumBonusStateColors,
  text: premiumTextStyles,
  fontFamily,
  space,
  radius: premiumRadius,
  elevation,
  layout,
  motion: { duration, easing, springConfig },
} as const;

export type TutakTheme = typeof tutakTheme;

/**
 * The light scheme, for anything that has to render on white — the
 * dashboards, and any future print or email surface.
 */
export const tutakLightTheme = {
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


/**
 * Jako on the dark scheme.
 *
 * Two changes from the light palette, both forced by the ground. The wing
 * accent moves from the old brand green to the premium blue — a green bird in
 * a blue-and-violet app looks like a leftover, which is exactly what it was.
 * And the plumage steps *lighter*: the greys chosen to sit on white are only
 * a few percent off #0A0A0F, so on the dark ground the bird was a silhouette
 * of itself.
 */
export const jakoPremiumColors: JakoColors = {
  brand: premium.brand.primary,
  body: neutral[300],
  crown: neutral[200],
  beak: neutral[600],
  beakShadow: neutral[700],
  scallops: '#8B93A1',
  eyePatch: neutral[25],
  pupil: neutral[900],
  catchlight: neutral[0],
};
