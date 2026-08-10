import React, { useEffect, useReducer } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { getEvents, resetEvents, subscribe } from './eventLog';
import { buildCommit, isDiagnosticBuild } from './isDiagnosticBuild';

/**
 * The event log, on the screen, in a screenshot.
 *
 * Deliberately plain: no theme, no shared components, fixed colours and sizes.
 * It has to keep working while the thing underneath it is misbehaving, and a
 * diagnostic that depends on the layout it is diagnosing is worth nothing.
 *
 * Positioned at the bottom because the fault is on forms, whose fields sit in
 * the upper half, and because the keyboard covering the log would defeat the
 * purpose — so it stops above where a keyboard reaches and stays there.
 *
 * ## Reading it
 *
 * - `kbShow h=…` many times in a row is the keyboard reporting new heights.
 *   The `×N` count is the whole answer to whether there is a loop.
 * - `scroll y=…` following each `kbShow` is the app moving the list. Several
 *   of those in a row, at different offsets, is a scroll fighting itself.
 * - `focus` and `blur` alternating without a tap between them is focus being
 *   taken away and returned.
 * - `win h=…` changing is the window resizing under the keyboard, which is
 *   what `useCompactLayout` reads — a `compact` flip next to it means the
 *   whole form re-laid-out, and that is a different fault from the other
 *   three.
 * - `render #N` climbing while nothing is touched is a render loop, and none
 *   of the above.
 */
export function DiagnosticOverlay() {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => subscribe(bump), []);

  if (!isDiagnosticBuild()) return null;

  const events = getEvents();
  const { width, height } = Dimensions.get('window');

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>
            {buildCommit()} · win {Math.round(width)}×{Math.round(height)}
          </Text>
          <Pressable onPress={resetEvents} hitSlop={12}>
            <Text style={styles.clear}>CLEAR</Text>
          </Pressable>
        </View>

        {events.length === 0 ? (
          <Text style={styles.empty}>tap a field</Text>
        ) : (
          events.map((event, index) => (
            <Text key={`${event.at}-${index}`} style={styles.line} numberOfLines={1}>
              {String(event.at).padStart(5, ' ')}ms {event.text}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `position: absolute` over everything, but transparent to touches except
  // on the panel itself — the fields underneath still have to be tappable,
  // because tapping them is the experiment.
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
  panel: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderColor: '#39FF14',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    margin: 4,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  header: { color: '#39FF14', fontSize: 11, fontWeight: '700' },
  clear: { color: '#39FF14', fontSize: 11, fontWeight: '700' },
  empty: { color: '#888', fontSize: 11 },
  // Monospace so the timestamps line up and a repeating pattern is visible as
  // a shape rather than having to be read.
  line: { color: '#39FF14', fontSize: 11, fontFamily: 'monospace' },
});
