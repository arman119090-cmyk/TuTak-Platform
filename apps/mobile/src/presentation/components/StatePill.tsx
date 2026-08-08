import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { BonusState } from '@tutak/design';
import { useTheme } from '../../app/theme/ThemeProvider';

const LABEL_KEY: Record<BonusState, string> = {
  available: 'bonus.statusAvailable',
  pending: 'bonus.statusPending',
  reserved: 'bonus.statusReserved',
};

/**
 * Compact bonus-state marker. Deliberately a tinted surface with a solid
 * dot rather than a saturated chip — the colour still identifies the state
 * instantly, but at a weight that lets the amount beside it stay dominant.
 *
 * On the dark theme the tint is a 12%-alpha wash, which needs a hairline of
 * the same hue to hold its shape; without it the pill dissolves into the
 * card behind it and only the dot survives.
 */
export function StatePill({ state, label }: { state: BonusState; label?: string }) {
  const { bonusState, space, radius, text } = useTheme();
  const { t } = useTranslation();
  const tone = bonusState[state];

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: tone.surface,
          borderColor: tone.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.full,
          paddingHorizontal: space[2],
          paddingVertical: space[1],
          gap: space[2] - 2,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone.fill }]} />
      <Text style={[text.caption, { color: tone.text }]}>{label ?? t(LABEL_KEY[state])}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
