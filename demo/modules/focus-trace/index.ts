import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * One record of the focus moving, taken on the Android side.
 *
 * `uptime` is `SystemClock.uptimeMillis()` — monotonic, so it cannot jump if
 * the wall clock is adjusted, and it is what the records are ordered by.
 * `wall` is there only to line these up against the JavaScript log.
 */
export interface FocusTraceRecord {
  uptime: number;
  wall: number;
  /** `focus` | `window` | `attach` | `detach` | `start` */
  kind: string;
  /** Class and id of the view that lost it, or `none`. Never any text. */
  from: string;
  to: string;
  /** Filtered Java frames, joined with ` < `. */
  stack: string;
}

interface FocusTraceNativeModule extends NativeModule {
  start(): void;
  stop(): void;
  drain(): FocusTraceRecord[];
}

/**
 * Absent unless the native side is in this build.
 *
 * `requireOptionalNativeModule` rather than the throwing variant on purpose:
 * a JavaScript-only run — Jest, `react-native-web`, a build made before this
 * module existed — must degrade to "no native trace" rather than fail to
 * start. The caller checks for `null` and says so in the log, so a missing
 * instrument is visible instead of looking like a quiet absence of events.
 */
export const FocusTrace = requireOptionalNativeModule<FocusTraceNativeModule>('TuTakFocusTrace');
