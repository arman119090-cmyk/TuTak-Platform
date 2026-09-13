import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../../app/theme/ThemeProvider';

/** The marker id the map uses for the person's own position. */
export const HERE_MARKER_ID = '__here__';

/**
 * Where the person is, drawn the way every map draws it: a filled dot with a
 * white ring, no label and no shadow of its own.
 *
 * Deliberately not a pin. A pin points at a place you could go to; this is
 * the one marker on the map that is not a destination, and shaping it like
 * the others would invite a tap that leads nowhere — which is why the screen
 * ignores a press on it as well.
 *
 * `TileMap` offsets every marker by a pin's height so its tip sits on the
 * coordinate. A dot has no tip, so it carries that offset back: the centre
 * of the dot is the position, which is what a dot means.
 */
export function HerePin() {
  const { color } = useTheme();

  return (
    <View style={styles.lift} pointerEvents="none">
      <View style={[styles.ring, { borderColor: color.surface }]}>
        <View style={[styles.dot, { backgroundColor: color.primary }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Cancels TileMap's pin-tip offset (translateX -18, translateY -36).
  lift: { transform: [{ translateX: 18 }, { translateY: 36 }] },
  ring: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
