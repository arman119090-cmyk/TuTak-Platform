import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { useCompactLayout } from './useCompactLayout';

/**
 * Jako, the brand character, in one of the fourteen situations the brand
 * set covers. Each state is one PNG-derived WebP under `assets/jako/`; the
 * mapping lives here and nowhere else, so a screen says what it is *for*
 * (`state="otp-entry"`) and never which file to draw.
 */
export type JakoState =
  | 'login'
  | 'phone'
  | 'otp-waiting'
  | 'otp-entry'
  | 'password'
  | 'reset-password'
  | 'verification'
  | 'confirm'
  | 'success'
  | 'warning'
  | 'partner-welcome'
  | 'partner-details'
  | 'partner-offer'
  | 'partner-submitted';

/* eslint-disable @typescript-eslint/no-require-imports */
const ASSETS: Record<JakoState, ImageSource> = {
  login: require('../../../assets/jako/login.webp'),
  phone: require('../../../assets/jako/phone.webp'),
  'otp-waiting': require('../../../assets/jako/otp-waiting.webp'),
  'otp-entry': require('../../../assets/jako/otp-entry.webp'),
  password: require('../../../assets/jako/password.webp'),
  'reset-password': require('../../../assets/jako/reset-password.webp'),
  verification: require('../../../assets/jako/verification.webp'),
  confirm: require('../../../assets/jako/confirm.webp'),
  success: require('../../../assets/jako/success.webp'),
  warning: require('../../../assets/jako/warning.webp'),
  'partner-welcome': require('../../../assets/jako/partner-welcome.webp'),
  'partner-details': require('../../../assets/jako/partner-details.webp'),
  'partner-offer': require('../../../assets/jako/partner-offer.webp'),
  'partner-submitted': require('../../../assets/jako/partner-submitted.webp'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export const JAKO_STATES = Object.keys(ASSETS) as JakoState[];

/** The asset a state draws; exported for tests and the design docs. */
export function jakoAsset(state: JakoState): ImageSource {
  return ASSETS[state];
}

export type JakoSize = 'hero' | 'compact' | 'inline';

/**
 * Heights in points. `hero` is the top of an auth or onboarding screen;
 * `compact` a screen that has to keep its form above the fold (the lock
 * screen, a status page); `inline` a small figure beside a heading.
 *
 * Every image in the set is square with the bird at one scale, so a fixed
 * height gives the same-sized Jako on every screen — which is what makes
 * him read as one character rather than fourteen illustrations.
 */
const HEIGHT: Record<JakoSize, { regular: number; compact: number }> = {
  hero: { regular: 196, compact: 132 },
  compact: { regular: 120, compact: 96 },
  inline: { regular: 72, compact: 64 },
};

interface Props {
  state: JakoState;
  size?: JakoSize;
  align?: 'center' | 'start' | 'end';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The one way Jako is drawn.
 *
 * Decorative, and declared so: the title beside him says what the screen
 * is, and a screen reader that announced "image, parrot with a padlock"
 * before every password field would be noise. `contain`, never a crop —
 * several assets touch the edge of their frame (the login wings, the
 * padlock), and any crop would clip them.
 *
 * ## Why the keyboard does not resize him
 *
 * The brief asks for a hero that shrinks when the keyboard opens. On this
 * app's Android handsets a keyboard-driven relayout is exactly the thing
 * that lost focus and closed the keyboard again (`useCompactLayout.ts`,
 * `KeyboardAwareScroll.tsx` — both document the incident). So the height
 * is decided once per *device* (a short phone gets the smaller figure) and
 * never per keyboard event. The hero sits at the top of a
 * `KeyboardAwareScroll`, and when a field is brought above the keyboard the
 * hero simply scrolls away — the effect the brief wants, without a layout
 * change during an interaction. No animation for the same reason, which
 * also satisfies reduced-motion settings by construction.
 */
export function JakoHero({ state, size = 'hero', align = 'center', style, testID }: Props) {
  const compact = useCompactLayout();
  const height = compact ? HEIGHT[size].compact : HEIGHT[size].regular;
  const alignItems = align === 'center' ? 'center' : align === 'start' ? 'flex-start' : 'flex-end';

  return (
    <View
      style={[{ height, alignItems }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID ?? `jako-${state}`}
      pointerEvents="none"
    >
      <Image
        source={ASSETS[state]}
        style={[styles.image, { height, width: height }]}
        contentFit="contain"
        transition={0}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { aspectRatio: 1 },
});
