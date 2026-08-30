import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * The one container in the system — a near-white glass card on the app's
 * light ground (see `light-premium.ts`'s own docblock: v2 is a light-only
 * release, so this always renders that scheme, never the dark one `glass`/
 * `glow` also support).
 *
 * Three things make it read as glass rather than as a plain white box: a
 * blur of whatever is behind it, a faint ink-tinted fill so the pane has
 * substance against a white ground, and a low-alpha hairline along its edge.
 * The border is the part people skip, and it is the part that matters:
 * without an edge, a blur is a smudge.
 *
 * Depth comes from a conventional soft shadow rather than a glow — on white,
 * a shadow pools under the element the way it would on paper; a glow only
 * reads as "light spilling out" against a dark ground, which this theme no
 * longer has.
 */
export function Surface({
  children,
  style,
  padded = true,
  elevated = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  elevated?: boolean;
}) {
  const { space, radius, glass, glow } = useTheme();

  const shape: ViewStyle = {
    borderRadius: elevated ? radius.xl : radius.lg,
    borderColor: glass.border,
  };

  return (
    <View style={[styles.base, shape, elevated ? glow.md.native : glow.sm.native, style]}>
      <GlassFill intensity={elevated ? 50 : 30}>
        <View style={{ padding: padded ? space[6] : 0 }}>{children}</View>
      </GlassFill>
    </View>
  );
}

/**
 * The blur itself, or an honest imitation of it on Android.
 *
 * `expo-blur` renders a real backdrop blur on iOS. On Android it needs an
 * experimental path that repaints the view hierarchy every frame, which is
 * fine for one card and visibly janky for a scrolling list of them — and a
 * loyalty app's main screens are exactly that list. Android therefore gets a
 * flat translucent fill: slightly less pretty, identical in colour, and it
 * scrolls at sixty frames a second, which the user notices and the blur they
 * would not.
 */
function GlassFill({ children, intensity }: { children: React.ReactNode; intensity: number }) {
  const { glass, premium } = useTheme();

  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={intensity} tint={premium.blurTint} style={styles.fill}>
        <View style={{ backgroundColor: glass.background }}>{children}</View>
      </BlurView>
    );
  }

  return <View style={[styles.fill, { backgroundColor: premium.card.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  fill: { width: '100%' },
});
