export * from './tokens/color';
export * from './tokens/typography';
export * from './tokens/layout';
export * from './tokens/motion';
export * from './tokens/premium';
export * from './tokens/light-premium';
export * from './brand/v2-icons';
export { buildCssVariables } from './css';

import { semantic, bonusStateColors, palette, neutral } from './tokens/color';
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
import { lightPremium, lightPremiumBonusStateColors } from './tokens/light-premium';

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
  mode: 'dark',
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

/**
 * `typeof tutakTheme` narrows every colour to the exact hex/rgba string the
 * dark scheme happens to use — `as const` all the way down, since the
 * literal types are what let `gradients.primary` work as a fixed 2-tuple and
 * `text.title.fontWeight` satisfy React Native's `TextStyle`. That is
 * correct for a single theme, but it means the *light* theme's `"#FFFFFF"`
 * is not literal-assignable to a field typed as the literal `"#0A0A0F"` —
 * two different themes can never satisfy the same fully-narrowed shape.
 *
 * The fields below are exactly the ones whose *values* differ between the
 * two themes (everything else — `text`, `space`, `radius`, `layout`,
 * `motion`, `palette` — is the literal same shared object either way, so
 * leaving it narrowed is both correct and what keeps e.g. `fontWeight`
 * type-checking against `TextStyle`). Each is re-typed here with its
 * *keys* still pinned to the dark scheme's shape (`Record<keyof typeof …>`)
 * but its string/number leaves widened — so a theme is still rejected for
 * missing or extra keys, just not for holding a different colour.
 */
type Widen<T> = T extends string ? string : T extends number ? number : { [K in keyof T]: Widen<T[K]> };

export type TutakTheme = Omit<
  typeof tutakTheme,
  'mode' | 'color' | 'premium' | 'gradients' | 'glass' | 'glow' | 'bonusState'
> & {
  mode: 'light' | 'dark';
  color: Widen<typeof premiumSemantic>;
  // `blurTint` is carved back out of the generic widening: both themes'
  // values ('dark' / 'light') are already members of the same two-value
  // union, so it does not have the cross-theme literal-mismatch problem the
  // rest of `premium` has — and `<BlurView tint={...}>` (`Surface.tsx`,
  // `HomeHeader.tsx`) needs that literal union, not a bare `string`.
  premium: Omit<Widen<typeof premium>, 'blurTint'> & { blurTint: 'light' | 'dark' };
  gradients: Widen<typeof premium.gradients>;
  glass: Widen<typeof premium.glass>;
  glow: Widen<typeof premiumGlow>;
  bonusState: Widen<typeof premiumBonusStateColors>;
};

/**
 * The phone's *second* theme: the light "glossy premium" scheme, approved
 * against a reference design (white ground, green gradient balance card,
 * glossy rounded cards) and shipped behind a persisted user toggle — see
 * `apps/mobile/src/data/stores/themeStore.ts` and `ThemeProvider.tsx`.
 *
 * Exactly the same keys as `tutakTheme`, which is what lets every mobile
 * screen call `useTheme()` once and work under either theme with no
 * per-screen branch: `color` swaps to the light `semantic` set, `premium`
 * swaps to `lightPremium`, and the rounder corners / heavier headings from
 * `premium.ts` carry over unchanged because those are shape tokens, not
 * colours.
 *
 * This is a different export from `tutakLightTheme` below on purpose — that
 * one is a smaller shape consumed only by the web dashboards, and changing
 * its keys or values would be a breaking change to code this theme has
 * nothing to do with.
 */
export const tutakMobileLightTheme = {
  mode: 'light',
  // `semantic` (color.ts) has no `textMuted` — nothing on the light web
  // dashboards has ever needed a fourth text tone, so it was never added
  // there. The dark scheme's `premiumSemantic.textMuted` exists but is
  // unused by every mobile screen today; this keeps the two themes' `color`
  // shape identical (required for `TutakTheme`) without adding an unused key
  // to `semantic` itself, which the dashboards depend on unchanged.
  color: { ...semantic, textMuted: neutral[300] },
  palette,
  premium: lightPremium,
  gradients: lightPremium.gradients,
  glass: lightPremium.glass,
  glow: lightPremium.glow,
  bonusState: lightPremiumBonusStateColors,
  text: premiumTextStyles,
  fontFamily,
  space,
  radius: premiumRadius,
  elevation,
  layout,
  motion: { duration, easing, springConfig },
} as const;

// Verified once, here, rather than trusted by convention: if a future edit
// to either theme drops or retypes a key, this line stops compiling instead
// of a screen quietly reading `undefined` from whichever theme it is not
// being visually tested against.
const _themeShapesMatch: TutakTheme = tutakMobileLightTheme;

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

