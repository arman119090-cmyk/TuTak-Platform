import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * One record of the focus moving, taken on the Android side.
 *
 * `uptime` is `SystemClock.uptimeMillis()` — monotonic, so it cannot jump if
 * the wall clock is adjusted, and it is what orders these records against
 * each other. `wall` is the only thing that lines one of these up against a
 * JavaScript line. Both are carried: neither can be derived from the other.
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

/**
 * What `start` actually managed to install.
 *
 * Every field is a measurement rather than an intention — a `false` means
 * that observer is genuinely not running. The point is that "no native lines"
 * must never be readable as "no focus changes happened".
 */
export interface FocusTraceStart {
  /** The global focus observer is running. Without it there is no trace. */
  ok: boolean;
  focus: boolean;
  /** Needs API 28; `false` below that, and the reason says so. */
  window: boolean;
  /** How many views are being watched for attach/detach right now. */
  attach: number;
  /** Whether the ViewTreeObserver accepted listeners at all. */
  alive: boolean;
  sdk: number;
  /** Empty when everything installed. */
  reason: string;
}

/** A drain, plus what the bounded buffer had to throw away to fit. */
export interface FocusTraceDrain {
  records: FocusTraceRecord[];
  dropped: number;
}

/** Where a view sits in the native tree — see `inspect` in the Kotlin side. */
export interface FocusTraceShape {
  found: boolean;
  tag: number;
  cls?: string;
  /** `Class#tag` of the native parent, or `none`. */
  parent?: string;
  /** Child count. `0` on a field box is the signature of a flattened node. */
  kids?: number;
  kidsDescribed?: string[];
  error?: string;
}

interface FocusTraceNativeModule extends NativeModule {
  start(): FocusTraceStart;
  stop(): void;
  drain(): FocusTraceDrain;
  inspect(tag: number): Promise<FocusTraceShape>;
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
