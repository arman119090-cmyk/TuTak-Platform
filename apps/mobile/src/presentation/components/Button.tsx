import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
 * Buttons press *inward* (scale 0.96) rather than changing colour on touch.
 * It reads as physical, matches the platform feel users already know, and
 * leaves the gradient undisturbed — a gradient that shifts on press looks
 * like a rendering glitch rather than a response.
 *
 * Only `primary` wears the blue→violet gradient, and there is at most one
 * primary button on a screen. That is the whole discipline of this palette:
 * the gradient means "this is the action", so the moment a second one
 * appears it stops meaning anything.
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
  const { color, space, radius, text, motion, glass, gradients, glow } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const press = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      ...motion.springConfig.snappy,
    }).start();

  // `minHeight`, never `height` — the same fix `TextField` already carries.
  // Android's display settings offer a font scale well above 1, and this view
  // sets `overflow: 'hidden'`, so a fixed box kept its size while the label
  // grew and the characters were simply cut off. A button whose text reads
  // "Log i" is not a smaller button, it is a broken one.
  const minHeight = size === 'lg' ? 54 : size === 'md' ? 46 : 38;

  const surface: Record<Variant, string> = {
    primary: 'transparent', // painted by the gradient below
    secondary: glass.light,
    tertiary: 'transparent',
    destructive: color.dangerSurface,
  };
  const foreground: Record<Variant, string> = {
    primary: color.textInverse,
    secondary: color.textPrimary,
    tertiary: color.textBrand,
    destructive: color.dangerText,
  };
  const borderColor: Record<Variant, string> = {
    primary: 'transparent',
    secondary: glass.border,
    tertiary: 'transparent',
    destructive: 'rgba(255, 59, 48, 0.28)',
  };

  const isDisabled = disabled || loading;

  const body = (
    <>
      {loading ? (
        <ActivityIndicator color={foreground[variant]} />
      ) : (
        <View style={[styles.content, { gap: space[2] }]}>
          {icon}
          <Text
            // Grows with the system setting, but not without limit: past
            // roughly a third larger, a two-word label wraps to a third line
            // and the button becomes a paragraph. Capping the scale keeps the
            // control recognisable while still honouring the preference.
            maxFontSizeMultiplier={1.3}
            style={[text.headline, styles.label, { color: foreground[variant] }]}
          >
            {label}
          </Text>
        </View>
      )}
    </>
  );

  const shape: ViewStyle = {
    minHeight,
    borderRadius: radius.md,
    paddingHorizontal: space[5],
    // So a label that has grown has somewhere to grow into rather than
    // pressing against the edge of the box.
    paddingVertical: space[2],
  };

  return (
    <Animated.View
      style={[
        { transform: [{ scale }], borderRadius: radius.md },
        // The glow belongs to the wrapper, not the gradient: a shadow on a
        // view with `overflow: hidden` is clipped away on Android.
        variant === 'primary' && !isDisabled ? glow.md.native : null,
        fullWidth && styles.full,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => press(0.96)}
        onPressOut={() => press(1)}
        style={[
          styles.base,
          shape,
          {
            backgroundColor: surface[variant],
            borderColor: borderColor[variant],
            borderWidth: variant === 'secondary' || variant === 'destructive' ? 1 : 0,
            opacity: isDisabled ? 0.4 : 1,
            overflow: 'hidden',
          },
        ]}
      >
        {variant === 'primary' ? (
          <LinearGradient
            colors={[...gradients.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.base]}
          />
        ) : null}
        {body}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  // `flexShrink` so a long label in Armenian or Russian — both of which run
  // noticeably longer than the English these widths were chosen against —
  // wraps inside the button instead of pushing an icon off its edge.
  content: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  label: { flexShrink: 1, textAlign: 'center' },
  full: { width: '100%' },
});
