import { useEffect } from 'react';
import { logEvent, startedAtMs } from './eventLog';
import { isDiagnosticBuild } from './isDiagnosticBuild';
import { FocusTrace, type FocusTraceRecord } from '../../modules/focus-trace';

/**
 * Brings the Android focus observers into the same log as everything else.
 *
 * ## Why a pull, on a timer
 *
 * The native side buffers from the moment it starts, and this drains it. That
 * ordering is the point: anything that happens before JavaScript is ready —
 * during startup, or between a focus change and the next render — is still
 * waiting to be collected rather than lost, which a fire-and-forget event
 * emitter could not promise.
 *
 * Draining on a short interval rather than reacting to something is
 * deliberate too. Whatever takes the focus away is exactly what this cannot
 * assume it will be told about.
 *
 * ## Two clocks, and why both are printed
 *
 * A drained row is written to the log when it is *collected*, up to
 * {@link DRAIN_INTERVAL_MS} after the thing it describes happened. In the
 * build-40 capture that produced exactly the hazard it sounds like: `ndetach`
 * appeared once before and once after the `blur` it belongs with, purely
 * because of when each drain landed. So a native row now carries both times
 * explicitly:
 *
 * ```
 * nfocus none → ReactEditText#2988 ev=22588 lag=250 u=1301074 w=1757419283123  <stack>
 * ```
 *
 * - the row's own `NNNNNms` column is **when JavaScript collected it**;
 * - `ev=` is **when it happened**, in the same milliseconds as every other
 *   row — `wall` minus the log's zero point, so it is directly comparable to
 *   a `focus` or `blur` line;
 * - `lag=` is the difference, which is the number that says how far the
 *   column can be trusted;
 * - `u=` is the native monotonic clock, which is what orders native rows
 *   against *each other* and cannot jump if the wall clock is adjusted;
 * - `w=` is the raw wall clock, kept so nothing here is a lossy derivation.
 *
 * **Order native rows by `ev=`, never by the column.**
 *
 * ## What the stack is and is not
 *
 * The stack is the stack **of the notification**, not necessarily of the
 * cause: Android delivers a global focus change from its own handling, so a
 * change that was posted rather than made inline no longer has its originator
 * on the stack. Treat it as narrowing, not as naming.
 */

/** Often enough to be useful, rare enough not to be part of the problem. */
const DRAIN_INTERVAL_MS = 250;

function describe(record: FocusTraceRecord, receivedAt: number): string {
  const event = record.wall - startedAtMs();
  const head =
    `n${record.kind} ${record.from} → ${record.to}` +
    ` ev=${event} lag=${receivedAt - event} u=${record.uptime} w=${record.wall}`;
  return record.stack ? `${head}  ${record.stack}` : head;
}

/**
 * Starts the observers and drains them into the event log.
 *
 * Diagnostic builds only, and silent about it in any other. What it is not
 * silent about is its own state: the line it writes on startup is the
 * native module's own report of which observers actually installed, because
 * "no native lines" must never be readable as "no focus changes happened".
 */
export function useNativeFocusTrace(): void {
  useEffect(() => {
    if (!isDiagnosticBuild()) return;

    const trace = FocusTrace;
    if (!trace) {
      logEvent('trace native-focus UNAVAILABLE (no native module in this build)');
      return;
    }

    try {
      const started = trace.start();
      logEvent(
        `trace native-focus ${started.ok ? 'armed' : 'NOT ARMED'}` +
          ` focus=${started.focus ? 1 : 0} window=${started.window ? 1 : 0}` +
          ` attach=${started.attach} alive=${started.alive ? 1 : 0} sdk=${started.sdk}` +
          (started.reason ? ` (${started.reason})` : ''),
      );
      if (!started.ok) return;
    } catch (err) {
      logEvent(`trace native-focus FAILED (${(err as Error).message.slice(0, 40)})`);
      return;
    }

    // A drain that throws every tick would otherwise be indistinguishable
    // from an instrument with nothing to report. Said once, not on every
    // tick: four times a second would bury the log it is reporting on.
    let complained = false;

    const drain = () => {
      try {
        const { records, dropped } = trace.drain();
        // First, so a gap in what follows is never mistaken for quiet.
        if (dropped > 0) logEvent(`ntrace DROPPED ${dropped} records (buffer full)`);
        const receivedAt = Date.now() - startedAtMs();
        for (const record of records) logEvent(describe(record, receivedAt));
      } catch (err) {
        // A module torn down under us, or a value the bridge would not
        // convert. Either way this must not throw into a timer callback.
        if (!complained) {
          complained = true;
          logEvent(`ntrace DRAIN FAILED (${(err as Error).message.slice(0, 40)})`);
        }
      }
    };

    const timer = setInterval(drain, DRAIN_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      drain();
      try {
        trace.stop();
      } catch {
        // Already gone.
      }
    };
  }, []);
}

/**
 * Records where a view actually sits in the native tree.
 *
 * The one thing JavaScript cannot see, and the one thing that decides whether
 * a negative result from the `CF` arm means anything. Fabric mounts a
 * flattened node's children into an ancestor rather than into the node, so a
 * field box reporting `kids=0` is flattened and one reporting `kids=2` is
 * not. That is the difference `collapsable={false}` is supposed to make, read
 * directly instead of inferred from whether the fault happened.
 *
 * Silent when there is no native module: a JS-only run has nothing to say
 * here and should not fill the log saying it.
 */
export async function logNativeShape(label: string, tag: number | null): Promise<void> {
  const trace = FocusTrace;
  if (!trace || tag === null) return;

  try {
    const shape = await trace.inspect(tag);
    logEvent(
      shape.found
        ? `shape ${label} #${shape.tag} ${shape.cls} parent=${shape.parent} kids=${shape.kids}`
        : `shape ${label} #${tag} NOT FOUND${shape.error ? ` (${shape.error})` : ''}`,
    );
  } catch (err) {
    logEvent(`shape ${label} #${tag} FAILED (${(err as Error).message.slice(0, 30)})`);
  }
}
