import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

type Tone = 'raised' | 'subtle' | 'plain';

/**
 * The one container in the system.
 *
 * Three tones, and the choice between them is most of what makes a screen
 * read as designed rather than assembled:
 *
 * - `raised` — a white card lifted off the white ground by a soft neutral
 *   shadow and nothing else. No hairline: an edge drawn around a card that
 *   already casts a shadow is the "frame inside a frame" that made the
 *   product look cheap, and it is gone.
 * - `subtle` — a quiet grey group (`backgroundSubtle`), flat, no shadow, no
 *   edge. For grouped rows (Settings, lists) where a card would be too much
 *   presence and a bare list too little.
 * - `plain` — no fill at all; padding only. For content that should sit
 *   directly on the ground.
 *
 * There is no blur any more. iOS blurred and Android could not, so the two
 * platforms shipped different products; a flat white card looks the same on
 * both and scrolls at sixty frames on either.
 *
 * `elevated` is kept for callers that already pass it: it is `raised` with
 * the hero's shadow, for the one or two cards on a screen that should feel
 * closest to the reader.
 */
export function Surface({
  children,
  style,
  padded = true,
  elevated = false,
  tone = 'raised',
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  elevated?: boolean;
  tone?: Tone;
}) {
  const { space, radius, color, glow } = useTheme();

  const fill: ViewStyle =
    tone === 'raised'
      ? { backgroundColor: color.surface, ...(elevated ? glow.md.native : glow.sm.native) }
      : tone === 'subtle'
        ? { backgroundColor: color.backgroundSubtle }
        : {};

  return (
    <View
      style={[
        styles.base,
        { borderRadius: radius.lg, padding: padded ? space[5] : 0 },
        fill,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // `overflow: hidden` would clip the shadow on Android; children that need
  // clipping (an image) round their own corners.
  base: {},
});
