import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/theme';

export function Card({
  children,
  style,
  padded = true,
  tone = 'surface',
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  tone?: 'surface' | 'muted' | 'brand';
}) {
  const theme = useTheme();
  const background =
    tone === 'muted'
      ? theme.colors.surfaceMuted
      : tone === 'brand'
        ? theme.colors.primarySoft
        : theme.colors.surface;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: background,
          borderRadius: theme.radius.card,
          padding: padded ? theme.spacing.base : 0,
          borderColor: theme.colors.border,
        },
        theme.elevation.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
