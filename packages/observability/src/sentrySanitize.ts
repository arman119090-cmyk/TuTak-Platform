/**
 * The one privacy policy every Sentry integration in this repository runs
 * every event and breadcrumb through before it leaves the device or process.
 *
 * `apps/mobile`, `apps/admin` and `apps/partner` import this module directly.
 * `apps/api` cannot: it has its own `rootDir` constraint that keeps it from
 * importing TypeScript source outside `apps/api/src` (the same constraint
 * documented in `docs/CODEBASE_AUDIT_2026-08-30.md` for `@tutak/shared-types`
 * and worked around there the same way — apps/api keeps its own copy at
 * `apps/api/src/common/observability/sentry-sanitize.ts`, tested separately).
 * Both copies must apply the same rules; if one changes, change both.
 */

/**
 * Substrings matched case-insensitively against every object key in an
 * event, breadcrumb, tag, extra field, context or user object. Any key
 * containing one of these has its value replaced, however deep it sits and
 * whatever is around it.
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
 * Recursively walks an arbitrary value — object, array, or scalar — and
 * replaces the value of every sensitive key with `REDACTED`. Arrays are
 * walked element-by-element; scalars pass through unchanged. A `seen` set
 * guards against a circular reference turning this into an infinite loop —
 * Sentry's SDK builds cyclic structures internally on occasion (a `cause`
 * chain that loops back on itself), and a sanitizer that hangs the process
 * is worse than one that ships an unredacted field.
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

/**
 * Fields allowed to reach Sentry untouched, per the spec this policy
 * implements: environment, release, service name, HTTP method, normalized
 * route, HTTP status, and the error's own name/message/stack. Everything
 * else in an event or breadcrumb goes through `scrubValue`, and a short list
 * of fields the SDK can populate on its own — the raw request body, cookies,
 * the query string, `user.ip_address` — is removed outright rather than
 * merely scrubbed, because their presence at all is the problem, not their
 * key names.
 */
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
    // Never attach a request body, whatever it contains — the spec is
    // explicit that a body is not sent at all, not merely scrubbed.
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

  // `sendDefaultPii: false` already keeps the SDK from populating these on
  // its own; this is the defense-in-depth backstop for anything a future
  // integration or a manual `Sentry.setContext` call adds regardless.
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

/** `beforeBreadcrumb` — applied to every breadcrumb (nav, console, HTTP, click) before it is attached to the next event. */
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
