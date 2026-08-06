import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../app/theme/ThemeProvider';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme, spacing, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surfaceAlt,
          borderColor: theme.border,
          borderRadius: radius.lg,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
});
