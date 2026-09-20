import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Text } from './Text';

export type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

/**
 * A small status label. Colour is never the only signal — the label carries the
 * meaning — so it reads the same for a colour-blind driver and in a screenshot
 * sent to support.
 */
export function StatusPill({ tone, label }: { tone: PillTone; label: string }) {
  const theme = useTheme();
  const colours: Record<PillTone, { fg: string; bg: string }> = {
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
    info: { fg: theme.colors.info, bg: theme.colors.infoSoft },
    brand: { fg: theme.colors.primary, bg: theme.colors.primarySoft },
    neutral: { fg: theme.colors.textSecondary, bg: theme.colors.surfaceMuted },
  };
  const { fg, bg } = colours[tone];

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: bg,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
        },
      ]}
    >
      <Text variant="micro" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', flexShrink: 1 },
});
