import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * Home-screen shortcut: a quiet grey tile with a single brand-coloured
 * glyph and a short label. The tiles used to be tinted per "tone" (blue for
 * charging, green for partners), which made two neighbours look like two
 * different apps; one neutral tile and one icon colour reads as a set.
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
  const { color, space, radius, text, motion, palette } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  // `tone` is kept in the signature so callers do not change; every tone
  // now renders the same neutral tile (see the note above).
  void tone;
  const tint = { surface: palette.neutral[50], fg: color.primary };

  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, ...motion.springConfig.snappy }).start();

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        style={styles.pressable}
      >
        <View
          style={[
            styles.icon,
            { backgroundColor: tint.surface, borderRadius: radius.md, marginBottom: space[2] },
          ]}
        >
          <Ionicons name={icon} size={22} color={tint.fg} />
        </View>
        <Text
          style={[text.label, { color: color.textPrimary, textAlign: 'center' }]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  pressable: { alignItems: 'center' },
  icon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});
