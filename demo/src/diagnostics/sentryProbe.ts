import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

/**
 * A Sentry event an operator can produce on purpose, from a build made for
 * exactly that.
 *
 * The app has no other way to answer "does Sentry actually receive anything
 * from the phone". `ErrorBoundary` and `Sentry.wrap` catch real failures,
 * which is the right design and useless as a check: you cannot ask a build
 * to fail on cue, and nobody should ship a button that makes it.
 *
 * So this sends the event without breaking anything. It captures a probe
 * exception and flushes it; the screen the operator was looking at is
 * exactly where they still are afterwards.
 *
 * ## Why two gates, not one
 *
 * `isDiagnosticBuild()` alone is nearly enough — only the `diagnostic` EAS
 * profile sets it. Nearly is the problem: a profile is a line in a JSON file
 * that somebody can copy into the wrong place, and the cost of being wrong
 * here is a control that ships to customers. So the environment has to agree
 * as well, and `production` is not on the list. Two independent facts have to
 * be true, and neither is a default.
 *
 * The probe reuses the same `Sentry.init` — and therefore the same
 * `beforeSend` sanitizer — as every other event the app sends. It attaches
 * only `service` and `kind`, both of which are on the tag allowlist; the
 * error's message is dropped like every other message, which is why the
 * class name is what identifies it in Sentry.
 */

/** Non-production environments where the probe may exist. `production` is absent. */
export const PROBE_ALLOWED_APP_ENVS: readonly string[] = ['preview', 'staging'];

export class SentryVerificationProbe extends Error {
  constructor() {
    super('TuTak Sentry verification probe');
    this.name = 'SentryVerificationProbe';
  }
}

/**
 * Whether the control may be rendered and the probe fired at all.
 *
 * Both halves come from `extra`, fixed at build time by `app.config.js`, so
 * this is a property of the binary rather than of anything the running app
 * can be talked into.
 */
export function isSentryProbeAvailable(): boolean {
  const extra = Constants.expoConfig?.extra ?? {};
  if (extra.diagnostics !== true) return false;
  const appEnv = extra.appEnv;
  return typeof appEnv === 'string' && PROBE_ALLOWED_APP_ENVS.includes(appEnv);
}

export type ProbeOutcome = 'sent' | 'not-flushed' | 'unavailable';

/**
 * Fires the probe. Deliberate: nothing calls this on startup, on navigation,
 * or on any path a customer could reach — only an explicit press in the
 * diagnostic overlay.
 *
 * Checks availability again rather than trusting the caller: the gate is the
 * guarantee, and a guarantee that depends on every call site remembering it
 * is not one.
 */
export async function runSentryProbe(): Promise<ProbeOutcome> {
  if (!isSentryProbeAvailable()) return 'unavailable';

  Sentry.withScope((scope) => {
    scope.setTag('service', 'mobile');
    scope.setTag('kind', 'sentry-verify');
    Sentry.captureException(new SentryVerificationProbe());
  });

  // `@sentry/react-native`'s `flush()` takes no timeout — unlike the Node
  // and Next SDKs, it uses the client's own `flushTimeout` option.
  const flushed = await Sentry.flush();
  return flushed ? 'sent' : 'not-flushed';
}
