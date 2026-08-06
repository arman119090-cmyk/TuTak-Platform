import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
type Size = 'lg' | 'md' | 'sm';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

/**
 * Buttons press *inward* (scale 0.97) rather than changing colour on touch.
 * It reads as physical, matches the platform feel users already know, and
 * avoids introducing a second green.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled,
  loading,
  icon,
  fullWidth = true,
}: Props) {
  const { color, space, radius, text, motion } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const press = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      ...motion.springConfig.snappy,
    }).start();

  const height = size === 'lg' ? 54 : size === 'md' ? 46 : 38;

  const surface: Record<Variant, string> = {
    primary: color.primary,
    secondary: color.primarySurface,
    tertiary: 'transparent',
    destructive: color.dangerSurface,
  };
  const foreground: Record<Variant, string> = {
    primary: color.textInverse,
    secondary: color.primary,
    tertiary: color.primary,
    destructive: color.dangerText,
  };

  const isDisabled = disabled || loading;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, fullWidth && styles.full]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        style={[
          styles.base,
          {
            height,
            backgroundColor: surface[variant],
            borderRadius: radius.lg,
            paddingHorizontal: space[5],
            opacity: isDisabled ? 0.4 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={foreground[variant]} />
        ) : (
          <View style={[styles.content, { gap: space[2] }]}>
            {icon}
            <Text style={[text.headline, { color: foreground[variant] }]}>{label}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center' },
  full: { width: '100%' },
});
