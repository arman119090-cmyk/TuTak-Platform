import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../app/theme/ThemeProvider';

export type BonusVisualState = 'AVAILABLE' | 'PENDING' | 'RESERVED';

const STATE_I18N_KEY: Record<BonusVisualState, string> = {
  AVAILABLE: 'bonus.statusAvailable',
  PENDING: 'bonus.statusPending',
  RESERVED: 'bonus.statusReserved',
};

/** Green = active/available, yellow = pending, blue = reserved — per brand spec. */
export function BonusStatusPill({ state }: { state: BonusVisualState }) {
  const { theme, radius, spacing, typography } = useAppTheme();
  const { t } = useTranslation();

  const color =
    state === 'AVAILABLE' ? theme.bonusAvailable : state === 'PENDING' ? theme.bonusPending : theme.bonusReserved;

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: `${color}22`, borderRadius: radius.pill, paddingHorizontal: spacing.sm },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[typography.caption, { color }]}>{t(STATE_I18N_KEY[state])}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
