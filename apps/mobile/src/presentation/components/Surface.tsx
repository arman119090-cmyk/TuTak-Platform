import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * The one container in the system. Depth comes from a hairline border plus
 * a barely-there ambient shadow — never a dark drop shadow, which is what
 * makes stacked cards on white still feel like one calm surface.
 */
export function Surface({
  children,
  style,
  padded = true,
  elevated = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  elevated?: boolean;
}) {
  const { color, space, radius, elevation } = useTheme();

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: color.surface,
          borderColor: color.border,
          borderRadius: radius.xl,
          padding: padded ? space[5] : 0,
        },
        elevated ? elevation.md.native : elevation.sm.native,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
