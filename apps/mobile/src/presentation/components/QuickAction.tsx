import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * Home-screen shortcut: a low grey bar with one outline glyph and a label,
 * two of them side by side under the primary button.
 *
 * It used to be a square tile with the label centred beneath — the shape of
 * an app-drawer icon, which is what made two of them under a full-width
 * button look like a launcher rather than a pair of secondary actions. A
 * horizontal bar is the same height as a control, reads left to right like
 * everything else on the screen, and sits with the button above it as one
 * group of three actions in two weights.
 */
export function QuickAction({
  icon,
  label,
  onPress,
  tone = 'brand',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'brand' | 'available' | 'pending' | 'reserved';
}) {
  const { color, space, radius, text, motion } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  // `tone` is kept in the signature so callers do not change; every tone
  // renders the same neutral bar (see the note above).
  void tone;

  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, ...motion.springConfig.snappy }).start();

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => press(0.98)}
        onPressOut={() => press(1)}
        style={({ pressed }) => [
          styles.bar,
          {
            backgroundColor: pressed ? color.surfaceSunken : color.backgroundSubtle,
            borderRadius: radius.md,
            paddingHorizontal: space[3],
            gap: space[2] + 2,
          },
        ]}
      >
        <Ionicons name={icon} size={20} color={color.primary} />
        <Text style={[text.label, styles.label, { color: color.textPrimary }]} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  bar: { minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  // 14/18 rather than the 15/22 label: two words on one line in all three
  // languages at 360 pt, which the bar is sized for.
  label: { flex: 1, flexShrink: 1, fontSize: 14, lineHeight: 18 },
});
