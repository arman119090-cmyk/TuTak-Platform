import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { sanitizeBreadcrumb, sanitizeSentryEvent } from '@tutak/observability';

/**
 * Error monitoring, off unless a DSN was baked into this build's `extra`
 * (see `app.config.js` — `sentryDsn`, sourced from `SENTRY_DSN` at build
 * time). The same "off unless configured" posture the API's own Sentry and
 * OpenTelemetry setup use: a build with no DSN — every local `expo start`,
 * and any CI/test run — must behave exactly as if this file did not exist,
 * not fail to boot over it.
 *
 * Deliberately error-monitoring only: `tracesSampleRate: 0` so this never
 * starts a span (there is no separate tracing system on the client to
 * duplicate, but the same policy line the other three apps use), and no
 * Session Replay, profiling or user-feedback integrations are added.
 */
export function initSentry(): boolean {
  const extra = Constants.expoConfig?.extra ?? {};
  const dsn = typeof extra.sentryDsn === 'string' ? extra.sentryDsn : '';
  if (!dsn) return false;

  const environment = typeof extra.appEnv === 'string' && extra.appEnv ? extra.appEnv : 'development';
  const release = typeof extra.commit === 'string' && extra.commit ? extra.commit : 'unknown';

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    initialScope: {
      tags: { service: 'mobile' },
    },
    beforeSend(event) {
      return sanitizeSentryEvent(event as never) as unknown as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeBreadcrumb(breadcrumb as never) as unknown as typeof breadcrumb;
    },
  });

  return true;
}
