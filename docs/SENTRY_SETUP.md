# Sentry error monitoring

Sentry is wired into all four apps as an error-only complement to the
existing observability stack — it does not replace OpenTelemetry tracing,
`AlertsService` (Redis-suppressed webhook alerts), or the structured JSON
logs. Every app is "off unless configured": with no DSN set, `Sentry.init()`
is never called and every `Sentry.*` call downstream is a documented safe
no-op, exactly like `startTracing()` already behaves with no OTel endpoint.

No tracing, profiling, Session Replay, logs, or user-feedback product is
enabled anywhere — `tracesSampleRate: 0` (or the Next.js/React Native
equivalent) in every config, and none of the SDKs' tracing/replay
integrations are added.

## Central scrubbing policy

`packages/observability` (`@tutak/observability`) is the canonical
sanitizer, used directly by `apps/mobile`, `apps/admin`, and `apps/partner`.
`apps/api` carries a byte-for-byte duplicate at
`apps/api/src/common/observability/sentry-sanitize.ts` because its
`tsconfig.build.json` forbids importing TypeScript source from outside
`apps/api/src` (the same constraint documented for `@tutak/shared-types` in
`docs/CODEBASE_AUDIT_2026-08-30.md`) — change both together.

The policy, wired through `beforeSend`/`beforeBreadcrumb` in every app:

- `sendDefaultPii: false` everywhere.
- Recursively scrubs any object/array key whose name (case-insensitive)
  contains: `authorization`, `token`, `cookie`, `password`, `otp`, `secret`,
  `api_key`, `apikey`, `session`, `refresh`, `access`, `payment`,
  `financial`.
- Strips query strings from every URL.
- Never attaches a request/breadcrumb body.
- Removes `user.ip_address`, `user.email`, and raw `extra.env` /
  `extra.process` / `extra.config`.

Tests: `packages/observability` has no test runner of its own (it is scrubbed
logic only, re-tested by every consumer) — see
`apps/api/src/common/observability/sentry-sanitize.spec.ts`,
`apps/mobile/src/app/sentry.test.ts`, and
`apps/{admin,partner}/src/lib/observability/sentryOptions.test.ts`.

## Release and environment tagging

All four apps tag events with the same commit SHA, resolved as
`GIT_COMMIT_SHA ?? EAS_BUILD_GIT_COMMIT_HASH ?? GITHUB_SHA ?? 'unknown'`
(mobile also accepts the EAS-specific variable; the others don't need it).
Set `GIT_COMMIT_SHA` in CI/build environments that don't already provide one
of the other two.

## Per-app configuration

### apps/api (NestJS)

- `apps/api/src/common/observability/sentry.ts` — `initSentry()`, called
  once from `main.ts` right after `startTracing()`.
- Captures: unhandled process-level errors surfaced by `bootstrap().catch()`
  in `main.ts` (then flushes and exits 1, same as before); every unexpected
  HTTP 5xx, captured exactly once inside the single global
  `AllExceptionsFilter` (never 4xx — validation/auth/business-rule errors
  never reach Sentry); the one BullMQ processor's permanent job failure
  (`SweepsProcessor.onFailed`, only once retries are exhausted, alongside the
  existing `alerts.fire()` call); the ledger outbox's dead-letter branch
  (`OutboxService`, same "alongside the alert, not instead of it" rule).
- Every event carries only: `environment`, `release` (commit SHA), `service:
  'api'` tag, and — for HTTP errors — `http.method` / `http.route`
  (normalized, no query string) / `http.status_code`.
- Env vars: `SENTRY_DSN` (server-side secret-adjacent value — not a bundled
  secret, but not printed anywhere either), `GIT_COMMIT_SHA`.
- Verification: `pnpm --filter @tutak/api sentry:verify` (refuses to run
  when `NODE_ENV=production`; sends one synthetic error and confirms the
  SDK flushed it).

### apps/mobile (Expo / React Native)

- `apps/mobile/src/app/sentry.ts` — `initSentry()`, called from `index.ts`
  before `registerRootComponent`; app root wrapped in `Sentry.wrap(App)` for
  native-crash capture.
- `apps/mobile/src/app/ErrorBoundary.tsx` reports the caught error from
  inside the existing `componentDidCatch`, after the existing
  `setState`/`console.error` calls — the fallback UI is unchanged (see
  `ErrorBoundary.test.tsx`).
- DSN, environment, and release come from `app.config.js`'s `extra` block
  (non-secret, embedded in the built app manifest, read via
  `expo-constants`), matching the existing `apiBaseUrl`/`commit` pattern.
- Source-map upload: the official `@sentry/react-native/expo` config plugin
  (in `app.config.js`) and `@sentry/react-native/metro`'s `withSentryConfig`
  (wrapping the existing custom Metro config in `metro.config.js`).
  `SENTRY_AUTH_TOKEN` is deliberately **not** referenced anywhere in
  `app.config.js` — the plugin's native build-phase scripts read it directly
  from the EAS build environment via `sentry-cli`, so it never becomes part
  of the app manifest or the JS bundle.
- Build-time/EAS env vars: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL`
  (optional, self-hosted only) — public identifiers, safe in `eas.json`'s
  per-profile `env` block. `SENTRY_DSN` likewise (a DSN is not a secret).
  `SENTRY_AUTH_TOKEN` **must** be an EAS secret
  (`eas secret:create --name SENTRY_AUTH_TOKEN`), never added to `eas.json`
  or any committed file.
- `@sentry/react-native` is pinned to the exact string `~7.11.0` because
  `apps/mobile/src/sdkVersions.test.ts` checks it against
  `expo/bundledNativeModules.json` by exact string match, not semver
  resolution — bump only in lockstep with an Expo SDK upgrade.

### apps/admin and apps/partner (Next.js, App Router)

- `instrumentation-client.ts`, `sentry.server.config.ts`,
  `sentry.edge.config.ts` (all at the app root) each call
  `Sentry.init(buildSentryOptions())`, where `buildSentryOptions()` lives in
  `src/lib/observability/sentryOptions.ts` and is the one place all three
  runtimes' DSN/release/scrub config is defined.
- `instrumentation.ts`'s `register()` loads the server/edge config for the
  matching `NEXT_RUNTIME`, and exports `onRequestError =
  Sentry.captureRequestError` to catch server-component/route-handler errors
  Next's own request lifecycle would otherwise swallow.
- `src/app/global-error.tsx` reports React render errors that escape every
  nested error boundary (the official Next.js App Router pattern for this;
  neither app had any error boundary before, so nothing existing changed).
- `next.config.ts` wraps the config in `withSentryConfig`, using
  `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` for source-map
  upload and `sourcemaps.deleteSourcemapsAfterUpload: true` so maps are
  removed from the build output right after upload — combined with Next's
  existing default of not serving source maps at all
  (`productionBrowserSourceMaps` is left unset/false), production source
  maps are never public either way.
- `NEXT_PUBLIC_SENTRY_RELEASE` is set from `next.config.ts`'s `env` block
  (computed from `GIT_COMMIT_SHA`/`GITHUB_SHA` at build time) rather than
  imported from `@tutak/observability`, because `next.config.ts` is loaded
  by plain Node before workspace TypeScript sources resolve — the same
  reason `@tutak/design/security-headers` is plain `.mjs` rather than `.ts`.
- Env vars, both apps: `NEXT_PUBLIC_SENTRY_DSN` (public — DSNs are meant to
  be client-embedded), `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (optional, falls
  back to `NODE_ENV`), `GIT_COMMIT_SHA` (build-time only, becomes
  `NEXT_PUBLIC_SENTRY_RELEASE`). Build/CI-only secrets: `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (source-map upload; never reaches
  the browser bundle since it is only read inside `next.config.ts` at build
  time).
- Verification: `GET /api/internal/sentry-verify` — returns 404 unless both
  `NODE_ENV !== 'production'` **and** `SENTRY_VERIFY_ENABLED=true` are set;
  never returns anything beyond `{ "sent": boolean }`. Covered by
  `src/app/api/internal/sentry-verify/route.test.ts` in each app (404 in
  production even with the flag on, 404 outside production with the flag
  off, success path, and a check that the response body never grows beyond
  the boolean).

## What's still unverified

No `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` were available in this environment.
Everything above was verified as code and configuration — unit tests,
`tsc --noEmit`, lint, and production builds with no DSN set (all four apps
run/build normally, confirming the "off unless configured" posture) — but
live event ingestion and resolved production stack traces from uploaded
source maps have **not** been confirmed against a real Sentry project.
Before relying on this in production: set the DSNs, run each app's
verification mechanism (`pnpm --filter @tutak/api sentry:verify`, or the
`sentry-verify` route with `SENTRY_VERIFY_ENABLED=true` in a non-production
deployment), and confirm the event arrives with a readable stack trace.
