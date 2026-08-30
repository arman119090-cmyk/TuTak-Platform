/**
 * The API's own copy of the Sentry sanitization policy that `apps/mobile`,
 * `apps/admin` and `apps/partner` share as `@tutak/observability`.
 *
 * apps/api cannot import that package: its `tsconfig.build.json` sets
 * `rootDir` to `apps/api/src` (see `docs/CODEBASE_AUDIT_2026-08-30.md`'s
 * note on the exact same constraint blocking `@tutak/shared-types`), so any
 * source file outside `apps/api/src` fails TS6059 the moment it is imported.
 * This file must stay behaviourally identical to
 * `packages/observability/src/sentrySanitize.ts` — if one changes, change
 * both, and update the tests on both sides.
 */

export const SENSITIVE_KEY_SUBSTRINGS = [
  'authorization',
  'token',
  'cookie',
  'password',
  'otp',
  'secret',
  'api_key',
  'apikey',
  'session',
  'refresh',
  'access',
  'payment',
  'financial',
] as const;

export const REDACTED = '[Filtered]';

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

/**
 * Recursively replaces the value of every sensitive key, anywhere in an
 * object/array tree. `seen` guards against a circular reference (some of
 * which Sentry's own SDK can construct, e.g. an `Error.cause` chain that
 * loops back on itself) turning this into an infinite loop.
 */
export function scrubValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : scrubValue(entryValue, seen);
  }
  return result;
}

/** Drops everything after the first `?`, so a captured URL never carries a query string. */
export function stripQueryString(url: string | undefined | null): string | undefined {
  if (!url) return url ?? undefined;
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

interface SentryLikeRequest {
  url?: string;
  query_string?: unknown;
  cookies?: unknown;
  data?: unknown;
  headers?: Record<string, unknown>;
}

interface SentryLikeEvent {
  request?: SentryLikeRequest;
  user?: { ip_address?: string; email?: string; [key: string]: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: unknown[];
  [key: string]: unknown;
}

/** `beforeSend` — applied to every error/message event before Sentry ships it. */
export function sanitizeSentryEvent<T extends SentryLikeEvent>(event: T): T {
  const scrubbed = scrubValue(event) as T;

  if (scrubbed.request) {
    const request = { ...scrubbed.request };
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.url) request.url = stripQueryString(request.url);
    if (request.headers) request.headers = scrubValue(request.headers) as Record<string, unknown>;
    scrubbed.request = request;
  }

  if (scrubbed.user) {
    const user = { ...scrubbed.user };
    delete user.ip_address;
    delete user.email;
    scrubbed.user = user;
  }

  if (scrubbed.extra) {
    const extra = { ...scrubbed.extra };
    delete extra.env;
    delete extra.environment;
    delete extra.process;
    delete extra.config;
    delete extra.configuration;
    scrubbed.extra = extra;
  }

  return scrubbed;
}

/** `beforeBreadcrumb` — applied to every breadcrumb before it is attached to the next event. */
export function sanitizeBreadcrumb<T extends { data?: Record<string, unknown> }>(
  breadcrumb: T,
): T {
  const scrubbed = scrubValue(breadcrumb) as T;
  if (scrubbed.data) {
    const data = { ...scrubbed.data };
    if (typeof data.url === 'string') data.url = stripQueryString(data.url);
    delete data.body;
    delete data.request_body_size;
    scrubbed.data = data;
  }
  return scrubbed;
}
