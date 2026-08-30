import type { BrowserOptions } from '@sentry/nextjs';
import { sanitizeBreadcrumb, sanitizeSentryEvent } from '@tutak/observability';

/**
 * Shared by instrumentation-client.ts, sentry.server.config.ts and
 * sentry.edge.config.ts so all three runtimes apply the exact same DSN,
 * release, scrubbing and "tracing off" policy.
 *
 * `NEXT_PUBLIC_SENTRY_RELEASE` is set from next.config.ts's `env` block (the
 * only way to get a deterministic, non-`NEXT_PUBLIC_`-sourced commit SHA
 * into an Edge-runtime bundle, which has no live `process.env`).
 */
export function buildSentryOptions(): BrowserOptions {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || 'unknown',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    initialScope: { tags: { service: 'partner' } },
    beforeSend(event) {
      return sanitizeSentryEvent(event as never) as unknown as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeBreadcrumb(breadcrumb as never) as unknown as typeof breadcrumb;
    },
  };
}
