import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * Home-screen shortcut. Icon sits in a tinted square rather than floating,
 * which gives the row a rhythm and keeps the targets comfortably large.
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
  const { color, space, radius, text, motion, bonusState } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const tint =
    tone === 'brand'
      ? { surface: color.primarySurface, fg: color.primary }
      : { surface: bonusState[tone].surface, fg: bonusState[tone].text };

  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, ...motion.springConfig.snappy }).start();

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => press(0.95)}
        onPressOut={() => press(1)}
        style={styles.pressable}
      >
        <View
          style={[
            styles.icon,
            { backgroundColor: tint.surface, borderRadius: radius.lg, marginBottom: space[2] },
          ]}
        >
          <Ionicons name={icon} size={22} color={tint.fg} />
        </View>
        <Text
          style={[text.caption, { color: color.textSecondary, textAlign: 'center' }]}
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
  icon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
