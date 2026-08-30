import { StyleSheet } from 'react-native';

/**
 * Shared anatomy for every map pin (`StationPin`, `PartnerPin`): disc, stem,
 * and the badge only a selected pin wears. Kept in one place so the two pin
 * types stay pixel-identical on `TileMap`'s anchor math — 36 wide, stem tip
 * at the bottom — without relying on two copies never drifting apart.
 */
export const mapPinStyles = StyleSheet.create({
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
