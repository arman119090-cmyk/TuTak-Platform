/**
 * The API's own copy of the Sentry sanitization policy that `apps/mobile`,
 * `apps/admin` and `apps/partner` share as `@tutak/observability`.
 *
 * apps/api cannot import that package: its `tsconfig.build.json` sets
 * `rootDir` to `apps/api/src` (the same constraint documented in
 * `docs/CODEBASE_AUDIT_2026-08-30.md` for `@tutak/shared-types`), so any
 * source file outside that directory fails TS6059 the moment it is imported.
 * This file must stay behaviourally identical to
 * `packages/observability/src/sentrySanitize.ts`;
 * `scripts/verify-sentry-sanitizer-parity.js` runs both against the same
 * fixtures and fails the build if they ever diverge.
 *
 * ## Why there is no free text here at all
 *
 * Two earlier versions of this file tried to *find* secrets: first by object
 * key name, then additionally by pattern-matching the string values that
 * survived. Both reduce risk. Neither can prove anything. A regex that
 * catches `Authorization: Bearer …` says nothing about an opaque token with
 * no label, a customer's name, or a password that happens not to look like
 * one — and "we did not spot a secret" is not the same claim as "there is no
 * secret". For data that must never leave the process, the weaker claim is
 * not good enough.
 *
 * So this file no longer inspects free text. It drops it. Every field whose
 * contents are decided by something other than this codebase — the whole
 * `request` object (raw URL paths included), the root `message`, an
 * exception's `value`, a breadcrumb's `message`, a stack frame's source
 * lines, `fingerprint`, `user`, `extra`, `contexts`, breadcrumb `data`,
 * frame-local `vars` — is absent from the output regardless of what it held.
 *
 * What is left is structural and provably bounded by inspection of this
 * file alone:
 *
 *  - the tags this codebase sets itself, taken by *exact key* from
 *    `ALLOWED_TAG_KEYS` (the loop iterates the allowlist, never the input,
 *    so an unexpected key cannot be forgotten);
 *  - an error type validated to look like a class name, replaced with
 *    `Error` when it does not;
 *  - stack frames reduced to filename / function / module / line / column /
 *    in_app;
 *  - environment, release, and the SDK's own plumbing.
 *
 * The cost is real: a Sentry issue no longer carries the error's message.
 * What it does carry — service, environment, release, HTTP method, the
 * normalized route, the status code, the error class, and a full structural
 * stack — is enough to find the throw site and reproduce it from the code,
 * which is what a stack trace is for.
 */

/**
 * The only tag keys allowed onto an event. Matched exactly — no prefix, no
 * substring, no casing variation. Every one of these is set by this
 * codebase itself (`service` and `kind` in the init/verification scopes,
 * the three `http.*` in `captureApiException`), so their values are ours
 * rather than a caller's.
 */
export const ALLOWED_TAG_KEYS = [
  'service',
  'kind',
  'http.method',
  'http.route',
  'http.status_code',
] as const;

/** What an unrecognisable error type is reported as instead. */
export const FALLBACK_ERROR_TYPE = 'Error';

/**
 * A JavaScript class name and nothing else. This is a *shape* check on a
 * value that should always be an identifier, not an attempt to find a secret
 * inside free text — a `type` that fails it is replaced wholesale rather
 * than edited, so nothing unrecognised is ever passed through in part.
 */
const SAFE_ERROR_TYPE_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

/** SDK-generated mechanism identifiers: `generic`, `onunhandledrejection`, `auto.http.node`. */
const SAFE_MECHANISM_TYPE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function safeErrorType(type: unknown): string {
  return typeof type === 'string' && SAFE_ERROR_TYPE_PATTERN.test(type)
    ? type
    : FALLBACK_ERROR_TYPE;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

/**
 * Tags, taken by exact key from the allowlist. The loop walks
 * `ALLOWED_TAG_KEYS` rather than the input's own keys on purpose: an event
 * carrying a tag nobody anticipated cannot slip through by being unlisted,
 * because unlisted is the default and listing is the only way in.
 */
function sanitizeTags(tags: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!tags) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of ALLOWED_TAG_KEYS) {
    const value = tags[key];
    // Scalars only. A tag whose value is an object is not something this
    // codebase sets, and its contents are unknown by definition.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// --- The allowlisted shapes --------------------------------------------------

interface SentryLikeStackFrame {
  filename?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
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

export interface SentryLikeEvent {
  event_id?: string;
  timestamp?: number;
  platform?: string;
  level?: string;
  sdk?: unknown;
  environment?: string;
  release?: string;
  dist?: string;
  fingerprint?: string[];
  tags?: Record<string, unknown>;
  message?: unknown;
  exception?: { values?: SentryLikeExceptionValue[] };
  breadcrumbs?: SentryLikeBreadcrumb[];
  request?: unknown;
  user?: unknown;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A stack frame stripped to the structure that locates code. `context_line`,
 * `pre_context` and `post_context` — the actual source text around the
 * throw — are dropped: a hardcoded credential on the failing line is
 * exactly the kind of thing that ends up there, and there is no way to tell
 * a safe source line from an unsafe one. `vars` (frame locals) goes for the
 * same reason.
 */
function sanitizeFrame(frame: SentryLikeStackFrame): SentryLikeStackFrame {
  return withoutUndefined({
    filename: typeof frame.filename === 'string' ? frame.filename : undefined,
    function: typeof frame.function === 'string' ? frame.function : undefined,
    module: typeof frame.module === 'string' ? frame.module : undefined,
    lineno: typeof frame.lineno === 'number' ? frame.lineno : undefined,
    colno: typeof frame.colno === 'number' ? frame.colno : undefined,
    in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
  });
}

function sanitizeExceptionValue(entry: SentryLikeExceptionValue): SentryLikeExceptionValue {
  const mechanismType =
    typeof entry.mechanism?.type === 'string' && SAFE_MECHANISM_TYPE_PATTERN.test(entry.mechanism.type)
      ? entry.mechanism.type
      : undefined;

  return withoutUndefined({
    // A validated class name. `value` — the error's message — is never
    // carried: it is the single most common place for a token, an OTP, an
    // account number or a customer's name to end up.
    type: safeErrorType(entry.type),
    mechanism: entry.mechanism
      ? withoutUndefined({
          type: mechanismType,
          handled: typeof entry.mechanism.handled === 'boolean' ? entry.mechanism.handled : undefined,
        })
      : undefined,
    stacktrace: entry.stacktrace?.frames
      ? { frames: entry.stacktrace.frames.map(sanitizeFrame) }
      : undefined,
  });
}

/** `beforeSend` — applied to every error/message event before Sentry ships it. */
export function sanitizeSentryEvent<T extends SentryLikeEvent>(event: T): T {
  const sanitized: SentryLikeEvent = withoutUndefined({
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    sdk: event.sdk,
    environment: event.environment,
    release: event.release,
    dist: event.dist,
    tags: sanitizeTags(event.tags),
    exception: event.exception?.values
      ? { values: event.exception.values.map(sanitizeExceptionValue) }
      : undefined,
    breadcrumbs: Array.isArray(event.breadcrumbs)
      ? event.breadcrumbs.map((crumb) => sanitizeBreadcrumb(crumb))
      : undefined,
    // Deliberately absent, whatever the input held:
    //   request     — the whole object, raw URL path included. The safe
    //                 half of it already reaches Sentry as the http.method /
    //                 http.route / http.status_code tags, normalized at the
    //                 call site rather than reconstructed here.
    //   message     — arbitrary free text.
    //   fingerprint — arbitrary free text, and grouping is derivable from
    //                 the type + stack that do survive.
    //   user, extra, contexts — arbitrary, caller-shaped, unbounded.
  });

  return sanitized as T;
}

/**
 * `beforeBreadcrumb` — applied to every breadcrumb (nav, console, HTTP,
 * click) before it is attached to the next event. What survives is the
 * timeline skeleton: what kind of thing happened, at what severity, when.
 * `message` and `data` are both dropped — a console breadcrumb's message is
 * whatever was logged, and `data` is where an HTTP breadcrumb keeps the URL,
 * the headers and the body.
 */
export function sanitizeBreadcrumb<T extends SentryLikeBreadcrumb>(breadcrumb: T): T {
  const sanitized: SentryLikeBreadcrumb = withoutUndefined({
    category: typeof breadcrumb.category === 'string' ? breadcrumb.category : undefined,
    level: typeof breadcrumb.level === 'string' ? breadcrumb.level : undefined,
    timestamp: typeof breadcrumb.timestamp === 'number' ? breadcrumb.timestamp : undefined,
    type: typeof breadcrumb.type === 'string' ? breadcrumb.type : undefined,
  });

  return sanitized as T;
}
