import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useFonts } from 'expo-font';

/* eslint-disable @typescript-eslint/no-require-imports */
const FONTS = {
  'Caveat-Regular': require('../../../assets/fonts/Caveat-Regular.ttf'),
  'Caveat-Bold': require('../../../assets/fonts/Caveat-Bold.ttf'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Whether the handwriting face is available yet.
 *
 * Caveat (SIL Open Font License, `assets/fonts/OFL-Caveat.txt`) is loaded
 * once per process; every caller after the first gets `true` immediately.
 * The load is not awaited behind the splash: a note that arrives in the
 * system font for the first frame and settles into handwriting a moment
 * later is better than a splash that waits on 600 KB of glyphs.
 */
export function useHandwritingFont(): boolean {
  const [loaded] = useFonts(FONTS);
  return loaded;
}

/** Armenian has no free handwriting face; those notes fall back to an italic. */
const ARMENIAN = /[԰-֏]/;

interface Props {
  children: string;
  /** Point size of the handwriting; the fallback is drawn smaller to match its x-height. */
  size?: number;
  color: string;
  weight?: 'regular' | 'bold';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  testID?: string;
}

/**
 * A line in the brand's handwriting — the "Вместе дальше ♡" beside Jako.
 *
 * Decorative copy, never the only place a thing is said: the title next to
 * it carries the meaning, this carries the tone. So the fallback (Armenian,
 * or the frame before the font lands) is allowed to look different without
 * anything being lost.
 */
export function Handwritten({ children, size = 24, color, weight = 'bold', style, numberOfLines, testID }: Props) {
  const ready = useHandwritingFont();
  const handwriting = ready && !ARMENIAN.test(children);
  const family = weight === 'bold' ? 'Caveat-Bold' : 'Caveat-Regular';

  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      // Grows with the system setting, but capped: a decorative line at 1.3×
      // would run into the figure it annotates.
      maxFontSizeMultiplier={1.15}
      style={[
        handwriting
          ? { fontFamily: family, fontSize: size, lineHeight: Math.round(size * 1.05) }
          : [styles.fallback, { fontSize: Math.round(size * 0.7), lineHeight: Math.round(size * 0.9) }],
        { color },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  fallback: { fontStyle: 'italic', fontWeight: '600', letterSpacing: -0.2 },
});
