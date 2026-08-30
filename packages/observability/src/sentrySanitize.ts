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
 * Both copies must stay byte-for-byte identical; `scripts/verify-sentry-sanitizer-parity.js`
 * runs both against the same fixtures and fails the build if they ever
 * diverge — if you change one, change both and re-run that script.
 *
 * ## Why this is allowlist-first, not key-blocklist-first
 *
 * An earlier version of this file redacted a value only when it sat behind a
 * key name that looked sensitive (`password`, `token`, …). That misses a
 * secret sitting inside a *value* that was never filed under such a key: an
 * exception message that echoes `Authorization: Bearer …` back at whoever
 * threw it, a breadcrumb that logs a raw `Cookie` header, a stack frame whose
 * source line happens to contain a hardcoded key. Object keys we do not
 * control (a third-party library's error shape, a header name a client
 * chose) are not a safe boundary to trust.
 *
 * So `sanitizeSentryEvent`/`sanitizeBreadcrumb` no longer take "the input,
 * scrubbed" as their model. They take "a fixed set of fields known to be
 * safe" — environment, release, the tags this codebase sets itself, the
 * error's type/message/stack, HTTP method/normalized route/status — and
 * rebuild the output from that allowlist. Everything not on it (the complete
 * `user` object, `extra`, `contexts`, request headers/cookies/body, breadcrumb
 * `data`) is dropped outright, not merely key-scrubbed, because their
 * presence at all — under any key, in any shape — is the problem.
 *
 * Every string that *does* survive (messages, exception values, stack
 * `context_line`s, breadcrumb messages, tag values) still goes through
 * `scrubString`, which redacts by pattern rather than by key: Authorization/
 * cookie/token-style "key: value" fragments in any casing or punctuation,
 * bearer tokens, JWTs, email addresses, and long digit runs (phone numbers,
 * card and bank/IBAN numbers). A secret cannot survive an allowlisted field
 * just because nobody filed it under a key this policy recognises.
 */

export const REDACTED = '[Filtered]';

/**
 * Substrings matched case-insensitively against every object key. Any key
 * containing one of these has its value replaced outright, however deep it
 * sits — this is the fast, cheap first line of defense; `scrubString` below
 * is what catches the same categories of secret when they show up in a
 * *value* instead of behind one of these keys.
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
  'card',
  'bank',
  'iban',
  'phone',
  'email',
] as const;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

// --- Pattern-based scrubbing of string *values* -----------------------------
//
// Everything below runs against ordinary strings regardless of which key (if
// any) they sit behind, which is the point: an object key is not a trust
// boundary, and privacy wins over precision here, on purpose. A diagnostic
// number swept up by the digit-run rule below is an acceptable cost; a card
// number that survives because it appeared in a log message instead of a
// `cardNumber` field is not.

/** `Bearer <anything-up-to-whitespace>`, wherever it appears, with no key required. */
const BEARER_PATTERN = /\bBearer\s+\S+/gi;

/** Three dot-separated base64url segments — a JWT shape, with no key required. */
const JWT_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

/** An email address, wherever it appears. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * `keyword` immediately followed by `:` or `=` and a value, e.g.
 * `Authorization: Bearer …`, `x-api-key: sk_live_…`, `refresh_token=abc`,
 * `Cookie: sid=abc; Path=/`. The value half is greedy to end-of-line (`.`
 * does not match `\n`) rather than a single token, because a leaked value is
 * not reliably whitespace-free (`Bearer abc.def.ghi`, a whole cookie jar).
 * The gap between the keyword and the separator is deliberately narrow and
 * space-free (`api-key`, `apiKey`, `x_api_key` — never a whole extra English
 * word), so an ordinary sentence like "Access denied: contact support" does
 * not get eaten just because it contains the word "access".
 */
const KEY_ALTERNATION = SENSITIVE_KEY_SUBSTRINGS.map((k) => k.replace(/[-_]/g, '[-_]?')).join('|');
const KEY_VALUE_PATTERN = new RegExp(`\\b(${KEY_ALTERNATION})([a-z0-9_-]{0,12}?\\s*[:=]\\s*)([^\\n\\r]+)`, 'gi');

/**
 * A one-time password is often written as a bare number next to the word
 * "otp"/"code" with no `:`/`=` at all ("OTP 482913 expired", "482913 is your
 * verification code") — `KEY_VALUE_PATTERN` needs a separator and would miss
 * both. These two catch the digits in either order, within a short distance
 * of the keyword, without requiring one.
 */
const OTP_AFTER_KEYWORD_PATTERN = /\b(otp|code)\b[^\d\n]{0,20}(\d{4,8})\b/gi;
const OTP_BEFORE_KEYWORD_PATTERN = /\b(\d{4,8})[^\d\n]{0,20}\b(otp|code)\b/gi;

/**
 * A candidate run of digits, tolerant of the punctuation phone numbers,
 * card numbers, and bank/IBAN-style account numbers are usually written
 * with. The actual digit *count* (not the run length, which spaces and
 * dashes also pad) is checked in the replacer before anything is redacted,
 * so a short, mostly-punctuation coincidence (a UUID segment, a line:column
 * pair) is not swept up along with a real 9+ digit phone or 13+ digit card
 * number.
 */
const DIGIT_RUN_CANDIDATE = /\+?\(?\d[\d()\-\s]{4,}\d\b/g;
const MIN_SENSITIVE_DIGIT_COUNT = 9;

export function scrubString(value: string): string {
  if (!value) return value;
  let result = value;
  result = result.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  result = result.replace(JWT_PATTERN, REDACTED);
  result = result.replace(
    KEY_VALUE_PATTERN,
    (_match, keyword: string, sep: string) => `${keyword}${sep}${REDACTED}`,
  );
  result = result.replace(
    OTP_AFTER_KEYWORD_PATTERN,
    (_match, keyword: string) => `${keyword} ${REDACTED}`,
  );
  result = result.replace(
    OTP_BEFORE_KEYWORD_PATTERN,
    (_match, _digits: string, keyword: string) => `${REDACTED} ${keyword}`,
  );
  result = result.replace(EMAIL_PATTERN, REDACTED);
  result = result.replace(DIGIT_RUN_CANDIDATE, (match) => {
    const digitCount = (match.match(/\d/g) ?? []).length;
    return digitCount >= MIN_SENSITIVE_DIGIT_COUNT ? REDACTED : match;
  });
  return result;
}

/**
 * Recursively walks an arbitrary value — object, array, or scalar. A key
 * matching `isSensitiveKey` has its whole value replaced regardless of type;
 * every other string leaf, wherever it sits, is run through `scrubString`.
 * A `seen` set guards against a circular reference turning this into an
 * infinite loop — Sentry's own SDK builds cyclic structures internally on
 * occasion (an `Error.cause` chain that loops back on itself), and a
 * sanitizer that hangs the process is worse than one that ships an
 * unredacted field.
 */
export function scrubValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
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

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

// --- The allowlisted shapes --------------------------------------------------

interface SentryLikeStackFrame {
  filename?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  [key: string]: unknown;
}

interface SentryLikeExceptionValue {
  type?: string;
  value?: string;
  mechanism?: { type?: string; handled?: boolean; [key: string]: unknown };
  stacktrace?: { frames?: SentryLikeStackFrame[] };
  [key: string]: unknown;
}

export interface SentryLikeBreadcrumb {
  category?: string;
  level?: string;
  timestamp?: number;
  type?: string;
  message?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SentryLikeRequest {
  method?: string;
  url?: string;
  query_string?: unknown;
  cookies?: unknown;
  data?: unknown;
  headers?: Record<string, unknown>;
  [key: string]: unknown;
}

type SentryLikeMessage = string | { message?: string; formatted?: string; params?: unknown[] };

export interface SentryLikeEvent {
  event_id?: string;
  timestamp?: number;
  platform?: string;
  level?: string;
  logger?: string;
  sdk?: unknown;
  environment?: string;
  release?: string;
  dist?: string;
  fingerprint?: string[];
  tags?: Record<string, unknown>;
  message?: SentryLikeMessage;
  exception?: { values?: SentryLikeExceptionValue[] };
  breadcrumbs?: SentryLikeBreadcrumb[];
  request?: SentryLikeRequest;
  user?: { ip_address?: string; email?: string; [key: string]: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  [key: string]: unknown;
}

function sanitizeFrame(frame: SentryLikeStackFrame): SentryLikeStackFrame {
  return withoutUndefined({
    filename: frame.filename,
    function: frame.function,
    module: frame.module,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
    context_line: typeof frame.context_line === 'string' ? scrubString(frame.context_line) : frame.context_line,
    pre_context: Array.isArray(frame.pre_context) ? frame.pre_context.map(scrubString) : frame.pre_context,
    post_context: Array.isArray(frame.post_context) ? frame.post_context.map(scrubString) : frame.post_context,
    // `vars` — local variables captured at the frame — is deliberately not
    // in this list. It is not enabled by any integration this codebase
    // turns on, but if something ever did, it is exactly the kind of
    // arbitrary, caller-named data `extra`/`contexts` are excluded for.
  });
}

function sanitizeExceptionValue(entry: SentryLikeExceptionValue): SentryLikeExceptionValue {
  return withoutUndefined({
    type: entry.type,
    value: typeof entry.value === 'string' ? scrubString(entry.value) : entry.value,
    mechanism: entry.mechanism ? withoutUndefined({ type: entry.mechanism.type, handled: entry.mechanism.handled }) : undefined,
    stacktrace: entry.stacktrace?.frames ? { frames: entry.stacktrace.frames.map(sanitizeFrame) } : entry.stacktrace,
  });
}

function sanitizeMessage(message: SentryLikeMessage | undefined): SentryLikeMessage | undefined {
  if (message === undefined) return undefined;
  if (typeof message === 'string') return scrubString(message);
  return withoutUndefined({
    message: typeof message.message === 'string' ? scrubString(message.message) : message.message,
    formatted: typeof message.formatted === 'string' ? scrubString(message.formatted) : message.formatted,
    // `params` is arbitrary interpolation data supplied by whoever called
    // `captureMessage` — dropped rather than scrubbed, same reasoning as
    // `extra`/`contexts` below.
  });
}

/**
 * `beforeSend` — applied to every error/message event before Sentry ships
 * it. Rebuilds the event from the allowlisted fields only; `user`, `extra`,
 * and `contexts` are absent from the output regardless of what the input
 * carried, and `request` keeps only `method` and a query-free `url`.
 */
export function sanitizeSentryEvent<T extends SentryLikeEvent>(event: T): T {
  const sanitized: SentryLikeEvent = withoutUndefined({
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    logger: event.logger,
    sdk: event.sdk,
    environment: event.environment,
    release: event.release,
    dist: event.dist,
    fingerprint: Array.isArray(event.fingerprint) ? event.fingerprint.map(scrubString) : undefined,
    tags: event.tags ? (scrubValue(event.tags) as Record<string, unknown>) : undefined,
    message: sanitizeMessage(event.message),
    exception: event.exception?.values ? { values: event.exception.values.map(sanitizeExceptionValue) } : undefined,
    breadcrumbs: Array.isArray(event.breadcrumbs) ? event.breadcrumbs.map((crumb) => sanitizeBreadcrumb(crumb)) : undefined,
    request: event.request
      ? withoutUndefined({
          method: event.request.method,
          url: stripQueryString(event.request.url),
          // headers, cookies, query_string, and the request body are never
          // reattached here — see the module docblock.
        })
      : undefined,
    // `user`, `extra`, `contexts` are intentionally absent: see the module
    // docblock for why they are removed wholesale rather than key-scrubbed.
  });

  return sanitized as T;
}

/**
 * `beforeBreadcrumb` — applied to every breadcrumb (nav, console, HTTP,
 * click) before it is attached to the next event. Keeps only the fields a
 * breadcrumb needs to be useful as a timeline entry; `data` — an arbitrary,
 * caller-shaped object that can carry a request body, a cookie header, or a
 * credential-bearing URL — is dropped wholesale rather than key-scrubbed.
 * `message` is kept, since it is normally free text ("clicked Save"), but
 * still runs through `scrubString` in case it echoes something it should not.
 */
export function sanitizeBreadcrumb<T extends SentryLikeBreadcrumb>(breadcrumb: T): T {
  const sanitized: SentryLikeBreadcrumb = withoutUndefined({
    category: breadcrumb.category,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
    type: breadcrumb.type,
    message: typeof breadcrumb.message === 'string' ? scrubString(breadcrumb.message) : breadcrumb.message,
    // `data` is intentionally absent — see the docstring above.
  });

  return sanitized as T;
}
