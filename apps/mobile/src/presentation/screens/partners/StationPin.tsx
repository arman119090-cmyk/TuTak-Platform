import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';

/**
 * One TuTak charging station on the map.
 *
 * Same anatomy as `PartnerPin` — disc, stem, a badge that only the selected
 * pin wears — but green rather than brand blue. Green is this app's
 * "available" colour everywhere else (the connector dot, the free-bays pill),
 * so a station pin borrows it instead of the brand fill: on a mixed map the
 * colour alone should say "this one is ours to charge at" before anyone
 * reads the icon.
 */
export function StationPin({
  freeConnectors,
  totalConnectors,
  selected,
}: {
  freeConnectors: number;
  totalConnectors: number;
  selected: boolean;
}) {
  const { color, text, radius } = useTheme();
  const anyFree = freeConnectors > 0;

  return (
    <View style={styles.wrap} pointerEvents="none">
      {selected ? (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: anyFree ? color.availableFill : color.textTertiary,
              borderRadius: radius.full,
              marginBottom: 2,
            },
          ]}
        >
          <Text style={[text.overline, { color: color.textInverse }]}>
            {freeConnectors}/{totalConnectors}
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.disc,
          selected ? styles.discSelected : null,
          {
            backgroundColor: selected
              ? color.availableFill
              : anyFree
                ? color.availableSurface
                : color.surfaceSunken,
            borderColor: selected ? color.availableFill : color.availableFill,
          },
        ]}
      >
        <Ionicons
          name="flash"
          size={selected ? 18 : 15}
          color={selected ? color.textInverse : color.availableText}
        />
      </View>

      <View
        style={[styles.stem, { backgroundColor: selected ? color.availableFill : color.availableFill }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches PartnerPin's anchor exactly — 36 wide, stem tip at the bottom —
  // so the two pin types line up on the same coordinate math in `TileMap`.
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
