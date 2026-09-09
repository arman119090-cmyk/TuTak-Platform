import React, { useEffect, useReducer, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { TAIL_CAPACITY, getEvents, resetEvents, runId, subscribe } from './eventLog';
import { buildCommit, isDiagnosticBuild } from './isDiagnosticBuild';
import {
  experimentLabel,
  toggleCollapsableField,
  toggleFocusRerender,
  toggleScrollsChildToFocus,
  useCollapsableField,
  useFocusRerender,
  useScrollsChildToFocus,
} from './experiment';
import { ExportOutcome, shareLogFile, shareLogTail, shareLogText } from './logExport';
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
 * ## Why there are three export buttons
 *
 * The panel shows the last fourteen rows because that is what fits. Longer
 * logs go out through `logExport.ts`, which explains why one button became
 * three: TXT writes a file, TAIL sends fifty rows, TEXT sends everything as a
 * message and is the one that was found to truncate silently.
 *
 * ## Why the controls are on their own row
 *
 * They used to sit beside the header, and on a 384-wide screen the last two —
 * EXPORT and CLEAR, the two that matter most — were off the right edge and
 * unreachable. The row below wraps, so adding a button can no longer hide an
 * existing one.
 */

export function DiagnosticOverlay() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // The probe's own result, shown beside the button. Deliberately not routed
  // through the event log: that log is the app talking about itself, and
  // this is the operator's own action reporting back.
  const [probe, setProbe] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  // Same reasoning, and the same refusal to write to the log: an export is
  // the operator reading the log, and a log that records being read is a log
  // that changed while being read. `null` is "nothing exported yet".
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => subscribe(bump), []);
  // Re-renders the header when the arm is flipped.
  useScrollsChildToFocus();
  useFocusRerender();
  useCollapsableField();

  if (!isDiagnosticBuild()) return null;

  const events = getEvents();
  const { width, height } = Dimensions.get('window');

  // A share sheet that never opened and one the operator dismissed look the
  // same from JavaScript, so this says what happened rather than guessing.
  const report = (label: string, run: () => Promise<ExportOutcome>) => () => {
    setExported(`${label}…`);
    void run().then((outcome) =>
      setExported(outcome === 'shared' ? `${label} sent` : `${label} ${outcome}`),
    );
  };

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <View style={styles.panel}>
        {/* The run id is here as well as in the export, because a photograph
            of this panel is still the fastest way to send it and a mount
            count means nothing without knowing whether the runtime
            underneath it was replaced. */}
        <Text style={styles.header}>
          {buildCommit()} · {runId()} · {experimentLabel()} · win {Math.round(width)}×
          {Math.round(height)}
          {exported === null ? '' : ` · ${exported}`}
        </Text>

        {/* Its own row, and wrapping: on a 384-wide screen these did not all
            fit beside the header and the ones that fell off the edge could
            not be tapped at all. */}
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
              <Text style={styles.action}>
                {probe === 'idle' ? 'SENTRY' : probe === 'sending' ? 'SENDING' : probe.toUpperCase()}
              </Text>
            </Pressable>
          ) : null}
          {/* Flips the one parameter under comparison. Both arms then run
              in the same build, the same launch and the same handset,
              which is what separates a cause from a coincidence. */}
          <Pressable onPress={toggleScrollsChildToFocus} hitSlop={12}>
            <Text style={styles.action}>SCF</Text>
          </Pressable>
          {/* The second arm. Flip one at a time — the header shows both, so
              a trial with two changed at once is visible as such. */}
          <Pressable onPress={toggleFocusRerender} hitSlop={12}>
            <Text style={styles.action}>RR</Text>
          </Pressable>
          {/* The third arm — `collapsable={false}` on the field box. Flipping
              it makes every field write a fresh `shape` line, which is the
              only way to see that the prop reached the native view rather
              than trusting that it did. */}
          <Pressable onPress={toggleCollapsableField} hitSlop={12}>
            <Text style={styles.action}>CF</Text>
          </Pressable>
          {/* The whole log as a file. First choice: nothing between here and
              the receiving app can re-flow or clip it. */}
          <Pressable onPress={report('TXT', shareLogFile)} hitSlop={12}>
            <Text style={styles.action}>TXT</Text>
          </Pressable>
          {/* Short enough to survive any transport, including a photograph. */}
          <Pressable onPress={report('TAIL', shareLogTail)} hitSlop={12}>
            <Text style={styles.action}>TAIL{TAIL_CAPACITY}</Text>
          </Pressable>
          {/* The original path, kept as the fallback for a device that
              reports file sharing unavailable. */}
          <Pressable onPress={report('TEXT', shareLogText)} hitSlop={12}>
            <Text style={styles.action}>TEXT</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setExported(null);
              resetEvents();
            }}
            hitSlop={12}
          >
            <Text style={styles.action}>CLEAR</Text>
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
  header: { color: '#39FF14', fontSize: 11, fontWeight: '700' },
  action: { color: '#39FF14', fontSize: 11, fontWeight: '700' },
  // Wrapping is the point: a button that does not fit cannot be tapped, and
  // this panel gained three at once.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 2 },
  empty: { color: '#888', fontSize: 11 },
  // Monospace so the timestamps line up and a repeating pattern is visible as
  // a shape rather than having to be read.
  line: { color: '#39FF14', fontSize: 11, fontFamily: 'monospace' },
});
