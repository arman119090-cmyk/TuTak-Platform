import React, { useEffect, useReducer, useState } from 'react';
import { Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { getEvents, resetEvents, runId, serializeEvents, subscribe } from './eventLog';
import { buildCommit, isDiagnosticBuild } from './isDiagnosticBuild';
import { traceSummary } from './instanceTrace';
import { isSentryProbeAvailable, runSentryProbe } from './sentryProbe';

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
 * - `mount X #n @id` is read with the run id in the header: see
 *   `instanceTrace.ts`. A repeated mount line on its own says nothing about
 *   the activity being recreated.
 *
 * ## Why there is an export button
 *
 * The panel shows the last fourteen rows because that is what fits, and a
 * photograph of it has been the transport so far. The registration screen's
 * reported sequence is longer than that and spans two fields, so EXPORT hands
 * the whole retained log — with the build, the run id and the row count — to
 * whatever the phone can send text with. `Share` rather than a clipboard or a
 * file: it is in React Native itself, so this adds no dependency to an app
 * that has to keep building for a person who is waiting.
 */
/**
 * Hands the log to the phone's own share sheet.
 *
 * Deliberately not routed through the event log: an export is the operator
 * acting on the log, and a log that records being read is a log that changed
 * while being read.
 */
async function exportLog(): Promise<void> {
  const { width, height } = Dimensions.get('window');
  const screen = Dimensions.get('screen');
  try {
    await Share.share({
      message: serializeEvents({
        commit: buildCommit(),
        profile: String(Constants.expoConfig?.extra?.appEnv ?? 'unknown'),
        trace: traceSummary(),
        window: `${Math.round(width)}x${Math.round(height)}`,
        screen: `${Math.round(screen.width)}x${Math.round(screen.height)}`,
      }),
    });
  } catch {
    // A share sheet the user dismissed, or a device with nothing to share
    // to. Neither is worth an alert on top of the screen being diagnosed.
  }
}

export function DiagnosticOverlay() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // The probe's own result, shown beside the button. Deliberately not routed
  // through the event log: that log is the app talking about itself, and
  // this is the operator's own action reporting back.
  const [probe, setProbe] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  useEffect(() => subscribe(bump), []);

  if (!isDiagnosticBuild()) return null;

  const events = getEvents();
  const { width, height } = Dimensions.get('window');

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          {/* The run id is here as well as in the export, because a
              photograph of this panel is still the fastest way to send it and
              a mount count means nothing without knowing whether the runtime
              underneath it was replaced. */}
          <Text style={styles.header}>
            {buildCommit()} · {runId()} · win {Math.round(width)}×{Math.round(height)}
          </Text>
          <View style={styles.actions}>
            {/* Absent unless this is a diagnostic build of a non-production
                environment — see sentryProbe.ts for why both must hold. */}
            {isSentryProbeAvailable() ? (
              <Pressable
                onPress={() => {
                  setProbe('sending');
                  void runSentryProbe().then((outcome) =>
                    setProbe(outcome === 'sent' ? 'sent' : 'failed'),
                  );
                }}
                hitSlop={12}
              >
                <Text style={styles.clear}>
                  {probe === 'idle'
                    ? 'SENTRY'
                    : probe === 'sending'
                      ? 'SENDING'
                      : probe.toUpperCase()}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => void exportLog()} hitSlop={12}>
              <Text style={styles.clear}>EXPORT</Text>
            </Pressable>
            <Pressable onPress={resetEvents} hitSlop={12}>
              <Text style={styles.clear}>CLEAR</Text>
            </Pressable>
          </View>
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
  actions: { flexDirection: 'row', gap: 12 },
  empty: { color: '#888', fontSize: 11 },
  // Monospace so the timestamps line up and a repeating pattern is visible as
  // a shape rather than having to be read.
  line: { color: '#39FF14', fontSize: 11, fontFamily: 'monospace' },
});
