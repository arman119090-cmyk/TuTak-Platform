import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
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
 * Buttons press *inward*, barely — scale 0.98 with the fill deepening one
 * step. The old 0.96 on a full-width control moved four points of edge on
 * each side, which reads as a jump; a fifth of that plus a tone change
 * reads as a response.
 *
 * `primary` is one solid brand green. There is no gradient and no glow: the
 * green *is* the identity, and a single flat, deep green is what an
 * expensive product looks like — the gradient made every screen carry a
 * small billboard. There is at most one primary button on a screen.
 *
 * `secondary` is a quiet neutral fill with no border. `tertiary` is text.
 * `destructive` is a tinted fill, no border, red text.
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
  const { color, space, radius, text, motion, palette } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = React.useState(false);

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
  const minHeight = size === 'lg' ? 52 : size === 'md' ? 44 : 36;

  const surface: Record<Variant, string> = {
    primary: pressed ? color.primaryPressed : color.primary,
    secondary: pressed ? color.fillSubtlePressed : color.fillSubtle,
    tertiary: pressed ? color.fillSubtle : 'transparent',
    destructive: pressed ? palette.danger[100] : color.dangerSurface,
  };
  const foreground: Record<Variant, string> = {
    primary: color.textInverse,
    secondary: color.textPrimary,
    tertiary: color.textBrand,
    destructive: color.dangerText,
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
    <Animated.View style={[{ transform: [{ scale }], borderRadius: radius.md }, fullWidth && styles.full]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => {
          setPressed(true);
          press(0.98);
        }}
        onPressOut={() => {
          setPressed(false);
          press(1);
        }}
        style={[
          styles.base,
          shape,
          {
            backgroundColor: surface[variant],
            opacity: isDisabled ? 0.45 : 1,
            overflow: 'hidden',
          },
        ]}
      >
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
