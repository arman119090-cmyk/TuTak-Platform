import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'large' | 'medium';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  /** Rendered under the label — used for "You receive 9 680 ֏" on the CTA. */
  caption?: string;
}

/**
 * The primary action is 60pt tall and full width by design: the main flow is
 * used one-handed, in a car, sometimes with gloves on. A 44pt button is the
 * platform minimum, not a target.
 *
 * A loading button stays mounted and keeps its size rather than collapsing into
 * a spinner, so the layout does not jump while a payout is being confirmed —
 * and it is disabled while loading, because a double tap on Confirm is exactly
 * the input this product must never mishandle.
 */
export function Button({
  label,
  caption,
  variant = 'primary',
  size = 'large',
  loading = false,
  fullWidth = true,
  disabled,
  onPress,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const height = size === 'large' ? theme.touchTarget.primaryAction : theme.touchTarget.comfortable;

  const background = (pressed: boolean): string => {
    if (variant === 'ghost') return 'transparent';
    if (isDisabled) {
      return variant === 'primary' ? theme.colors.primaryDisabled : theme.colors.surfaceMuted;
    }
    if (variant === 'primary') return pressed ? theme.colors.primaryPressed : theme.colors.primary;
    if (variant === 'danger') return pressed ? theme.colors.danger : theme.colors.dangerSoft;
    return pressed ? theme.colors.border : theme.colors.surfaceMuted;
  };

  const labelTone = variant === 'primary' ? 'inverse' : variant === 'danger' ? 'danger' : 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={caption ? `${label}. ${caption}` : label}
      disabled={isDisabled}
      onPress={(event) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress?.(event);
      }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: height,
          paddingVertical: caption ? theme.spacing.md : theme.spacing.sm,
          backgroundColor: background(pressed),
          borderRadius: theme.radius.control,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          paddingHorizontal: fullWidth ? theme.spacing.base : theme.spacing.xl,
          borderWidth: variant === 'ghost' ? 0 : 0,
          opacity: isDisabled && variant === 'ghost' ? 0.5 : 1,
        },
        style,
      ]}
      {...rest}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={variant === 'primary' ? theme.colors.onPrimary : theme.colors.primary}
          />
        ) : (
          <>
            <Text
              variant={size === 'large' ? 'bodyLarge' : 'label'}
              tone={labelTone}
              align="center"
            >
              {label}
            </Text>
            {caption ? (
              <Text
                variant="caption"
                tone={variant === 'primary' ? 'inverse' : 'secondary'}
                align="center"
                style={{ opacity: 0.85 }}
              >
                {caption}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
