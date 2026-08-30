import * as Sentry from '@sentry/node';
import type { Request } from 'express';
import { resolveReleaseSha } from './release';
import { sanitizeBreadcrumb, sanitizeSentryEvent } from './sentry-sanitize';

/**
 * Error monitoring, off unless `SENTRY_DSN` is set — the same "off unless
 * configured" posture `startTracing` (./tracing.ts) already uses for
 * OpenTelemetry, and for the same reason: a missing DSN is an observability
 * gap an operator will notice, not a reason to refuse to boot the way a
 * missing SMS/acquirer credential is in production.
 *
 * This is error monitoring only, deliberately layered next to — never on top
 * of — the tracing in `./tracing.ts`: `tracesSampleRate: 0` means Sentry
 * never starts a span or a transaction, so it cannot duplicate what
 * OpenTelemetry already exports. `AlertsService`/`WebhookAlertChannel` and
 * `StructuredLogger` are untouched by this file; nothing here calls them or
 * changes what they do.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: resolveReleaseSha(process.env),
    // Error monitoring only — see the module docblock. No tracing, no
    // profiling, no session replay (replay does not exist for Node), no
    // logs integration.
    tracesSampleRate: 0,
    // The SDK must never infer IP/user data on its own; every field that
    // reaches Sentry is one this module attaches explicitly and then runs
    // through the sanitizer below.
    sendDefaultPii: false,
    initialScope: {
      tags: { service: 'api' },
    },
    // Sentry's own `Event`/`Breadcrumb` types are wider than the minimal
    // shape `sentry-sanitize.ts` needs to do its job (and are tested against
    // that minimal shape directly, in sentry-sanitize.spec.ts) — the casts
    // here are the seam between "Sentry's type" and "the sanitizer's type",
    // not a loosening of what the sanitizer itself checks.
    beforeSend(event) {
      return sanitizeSentryEvent(event as never) as unknown as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeBreadcrumb(breadcrumb as never) as unknown as typeof breadcrumb;
    },
  });

  return true;
}

/**
 * `apps/api` cannot import `express.Request` fields it must not read (the
 * body, headers, cookies), so this only ever touches `method` and a
 * normalized path.
 *
 * "Normalized" here means query-string-free, and parameterized where Nest's
 * router has already matched a route (`req.route.path`, joined with
 * `req.baseUrl` since Nest mounts each controller as its own sub-router —
 * `req.route.path` alone is only the pattern *within* that controller, e.g.
 * `/:id` rather than `/v1/users/:id`). A request that never reached routing
 * (a malformed URL, a 404) has no `req.route`, so this falls back to the
 * query-stripped pathname, which is always available and never carries a
 * query string either way.
 */
export function normalizeRoute(request: Pick<Request, 'baseUrl' | 'route' | 'path'>): string {
  const pattern = request.route?.path as string | undefined;
  if (!pattern) return request.path;
  const base = request.baseUrl ?? '';
  return `${base}${pattern}` || request.path;
}

/**
 * Captures an unexpected server error with only the allow-listed metadata:
 * environment/release/service come from `Sentry.init` above; this call adds
 * exactly the HTTP method, the normalized route, and the status code as
 * tags, and lets Sentry read the error's own name/message/stack from the
 * exception object itself. Nothing else — no request body, no headers, no
 * user object — is ever passed in.
 *
 * Called from exactly one place, `AllExceptionsFilter`, and only when it has
 * already decided the response is a >=500 — so an event reaches Sentry
 * exactly once per unexpected error, never for an expected 4xx.
 */
export function captureApiException(
  exception: unknown,
  context: { method: string; route: string; status: number },
): void {
  Sentry.withScope((scope) => {
    scope.setTag('http.method', context.method);
    scope.setTag('http.route', context.route);
    scope.setTag('http.status_code', context.status);
    Sentry.captureException(exception);
  });
}
