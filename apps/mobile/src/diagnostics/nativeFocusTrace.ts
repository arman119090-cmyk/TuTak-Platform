import { useEffect } from 'react';
import { logEvent } from './eventLog';
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
 * ## Reading the lines
 *
 * ```
 * nfocus ReactEditText#7 → none  @1234567  ViewRootImpl.handleWindowFocusChanged:123 < …
 * ```
 *
 * `@…` is the native monotonic timestamp, which is what orders these against
 * each other. The JS log's own millisecond column is relative to CLEAR and is
 * not the same clock — comparing a native line to a JS line means comparing
 * `wall` values, and the export carries both.
 *
 * The stack is the stack **of the notification**, not necessarily of the
 * cause: Android delivers a global focus change from its own handling, so a
 * change that was posted rather than made inline no longer has its originator
 * on the stack. Treat it as narrowing, not as naming.
 */

/** Often enough to be useful, rare enough not to be part of the problem. */
const DRAIN_INTERVAL_MS = 250;

function describe(record: FocusTraceRecord): string {
  const head = `n${record.kind} ${record.from} → ${record.to} @${record.uptime}`;
  return record.stack ? `${head}  ${record.stack}` : head;
}

/**
 * Starts the observers and drains them into the event log.
 *
 * Diagnostic builds only, and silent about it in any other. A build without
 * the native side says so once, so that "no native lines" cannot be misread
 * as "no focus changes happened".
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
      trace.start();
      logEvent('trace native-focus armed');
    } catch (err) {
      logEvent(`trace native-focus FAILED (${(err as Error).message.slice(0, 40)})`);
      return;
    }

    const drain = () => {
      try {
        for (const record of trace.drain()) logEvent(describe(record));
      } catch {
        // A module torn down under us. The next tick either works or the
        // interval is cleared below; either way this must not throw into a
        // timer callback.
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
