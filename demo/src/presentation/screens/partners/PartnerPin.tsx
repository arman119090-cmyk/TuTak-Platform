import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PartnerCategory } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { CATEGORY_ICONS } from './categories';

/**
 * One partner on the map.
 *
 * A disc with the category's icon, on a stem that points at the coordinate —
 * the stem matters, because a bare circle centred on a point is ambiguous
 * about which point it means once there are two of them a block apart.
 *
 * Selected, it takes the brand fill and grows. Unselected pins stay dark with
 * a light border so a dense street reads as a set of markers rather than as a
 * wall of blue.
 */
export function PartnerPin({
  category,
  cashbackPercent,
  selected,
}: {
  category: PartnerCategory;
  cashbackPercent: number;
  selected: boolean;
}) {
  const { color, premium, text, radius } = useTheme();

  return (
    <View style={styles.wrap} pointerEvents="none">
      {selected ? (
        // Only the selected pin states its rate. Every pin carrying a number
        // turns the map into a page of numbers; one does the job, and the
        // list below carries the rest.
        <View
          style={[
            styles.badge,
            {
              backgroundColor: premium.brand.primary,
              borderRadius: radius.full,
              marginBottom: 2,
            },
          ]}
        >
          <Text style={[text.overline, { color: color.textInverse }]}>
            {cashbackPercent}%
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.disc,
          selected ? styles.discSelected : null,
          {
            backgroundColor: selected ? premium.brand.primary : premium.card.background,
            borderColor: selected ? premium.brand.light : premium.card.border,
          },
        ]}
      >
        <Ionicons
          name={CATEGORY_ICONS[category]}
          size={selected ? 18 : 15}
          color={selected ? color.textInverse : color.textPrimary}
        />
      </View>

      <View
        style={[
          styles.stem,
          { backgroundColor: selected ? premium.brand.primary : premium.card.border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 36 wide, 36 tall to the stem's tip — matches the anchor offset in
  // `TileMap`, which translates a marker up and left by exactly that so the
  // stem lands on the coordinate.
  wrap: { width: 36, alignItems: 'center' },
  disc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  discSelected: { width: 34, height: 34, borderRadius: 17, borderWidth: 2 },
  stem: { width: 2, height: 8 },
  badge: { paddingHorizontal: 6, paddingVertical: 2 },
});
