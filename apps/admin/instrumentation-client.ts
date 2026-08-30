import * as Sentry from '@sentry/nextjs';
import { buildSentryOptions } from './src/lib/observability/sentryOptions';

// No-op when NEXT_PUBLIC_SENTRY_DSN is unset (empty dsn is a documented safe
// no-op for every later Sentry.* call) — same "off unless configured" posture
// as the API and mobile apps.
Sentry.init(buildSentryOptions());

// Deliberately not exporting `onRouterTransitionStart` here: it wires up
// route-change spans for performance monitoring, which this integration does
// not enable (tracesSampleRate: 0, no tracing product — see
// src/lib/observability/sentryOptions.ts). The SDK's console warning about
// this hook being missing is expected.
