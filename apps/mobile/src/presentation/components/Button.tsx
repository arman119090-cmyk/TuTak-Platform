import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useAppTheme } from '../../app/theme/ThemeProvider';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading }: Props) {
  const { theme, spacing, radius, typography } = useAppTheme();

  const backgroundColor =
    variant === 'primary' ? theme.primary : variant === 'secondary' ? theme.primarySurface : 'transparent';
  const textColor = variant === 'primary' ? theme.textInverse : theme.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[typography.headline, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
