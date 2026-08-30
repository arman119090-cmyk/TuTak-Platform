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

The policy is a strict allowlist. It does not look for secrets — it drops
every field that could contain one.

That is the point of the final revision (task #1B). Two earlier versions
tried to *find* sensitive data: first by object key name, then additionally
by pattern-matching the strings that survived. Both reduce risk; neither
proves anything. A regex that catches `Authorization: Bearer …` says nothing
about an opaque token with no label, a customer's name, or a password that
happens not to look like one — and "we did not spot a secret" is a weaker
claim than "there is no secret". So free text is no longer inspected. It is
dropped.

Absent from every event, whatever it held:

- the entire `request` object — **including the raw URL path**, since
  `/v1/users/Арман` and `/v1/customers/123456789` are a name and an account
  number. The safe half already arrives as tags (below);
- the root `message`, an exception's `value` (the error message), and a
  breadcrumb's `message`;
- a stack frame's `context_line` / `pre_context` / `post_context` (source
  text around the throw, where a hardcoded credential lands) and its `vars`
  (frame locals);
- `fingerprint` — free text, and grouping is derivable from the type and
  stack that do survive;
- the complete `user` object, `extra`, `contexts`, breadcrumb `data`, and
  `captureMessage`'s `params`.

Present, and nothing else:

- `sendDefaultPii: false` everywhere;
- tags, by **exact key** from `ALLOWED_TAG_KEYS` — `service`, `kind`,
  `http.method`, `http.route`, `http.status_code`, all set by this codebase
  itself, scalar values only. The loop walks the allowlist rather than the
  input's keys, so an unanticipated tag cannot slip through by being
  unlisted;
- an error `type` validated to be identifier-shaped, replaced with `Error`
  when it is not (so a class name survives, an error message pasted into the
  type field does not);
- stack frames reduced to `filename` / `function` / `module` / `lineno` /
  `colno` / `in_app`, plus `mechanism.type` / `mechanism.handled`;
- `environment`, `release`, `dist`, and the SDK's own plumbing
  (`event_id`, `timestamp`, `platform`, `level`, `sdk`);
- breadcrumbs reduced to `category` / `level` / `timestamp` / `type`.

The cost is real: a Sentry issue no longer carries the error's message. What
it does carry — service, environment, release, HTTP method, normalized route,
status code, error class, and a full structural stack — locates the throw
site, which is what a stack trace is for.

`normalizeRoute` (apps/api) was tightened to match: a request that never
reached routing now reports `<unmatched>` rather than falling back to
`req.path`, so a 404 on `/v1/users/Арман` cannot put that name in the
`http.route` tag.

Tests: `packages/observability` has no test runner of its own (it is
policy logic only, re-tested by every consumer) — the privacy suite lives in
`apps/api/src/common/observability/sentry-sanitize.spec.ts` and covers every
category above by asserting on the *serialized* output ("this string does not
leave the process", not "this field I remembered to check is empty").
`apps/mobile`'s `sentry.test.ts` and `apps/{admin,partner}`'s
`sentryOptions.test.ts` prove the policy is actually wired into `beforeSend`/
`beforeBreadcrumb`; `sentry-otel.spec.ts` proves it again end to end through
the real, unmocked SDK pipeline.

**Parity between the two copies**: since apps/api cannot import
`@tutak/observability` (see above) and nothing at the type-checker level
would catch the two copies drifting apart, `scripts/verify-sentry-sanitizer-parity.js`
(`pnpm test:sentry-parity`, also run in CI right after `pnpm typecheck`)
loads both source files directly and runs the same fixture matrix through
both, failing loudly on any behavioural difference.

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
  SDK flushed it). Since the sanitizer drops free text, the probe is
  identified by what survives rather than by a marker string: the error
  class `SentryVerificationProbe` (an identifier, so it passes error-type
  validation) plus the allowlisted `kind=sentry-verify` and `service` tags.
  The script prints the send time locally to tell one run from the next.
- **OpenTelemetry coexistence** (task #1A): `initSentry()` sets
  `skipOpenTelemetrySetup: true`, the option `@sentry/node` documents
  specifically for "an app that already runs its own OpenTelemetry SDK".
  Without it, Sentry calls its own `initOpenTelemetry()` on init, which
  registers a second tracer provider, context manager, propagator, and
  sampler on top of the ones `tracing.ts`'s `startTracing()` already
  installed. `tracesSampleRate: 0` alone only stops Sentry's spans from being
  *exported*; `skipOpenTelemetrySetup` stops it from building that pipeline
  at all. `sentry-otel.spec.ts` proves this against the real SDKs (no
  mocking of `@sentry/node`/`@opentelemetry/api`): the global tracer
  provider `startTracing()` registered is untouched after `initSentry()`
  runs, `Sentry.getClient().traceProvider` stays `undefined` (proof
  `initOpenTelemetry()` was never called), `Sentry.captureException` still
  delivers an event through a custom in-memory transport, and a real span
  created via apps/api's own tracer after Sentry initializes still produces
  a valid trace id.

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
  `NEXT_PUBLIC_SENTRY_RELEASE`). Runtime-only, for the verification route:
  `APP_ENV`, `SENTRY_VERIFY_ENABLED`, and `SENTRY_VERIFY_TOKEN` — the last
  of which **is a secret**: anyone holding it can put events in your Sentry
  project from any box where the other two are also set. It belongs in the
  deployment's secret storage, never in a repository file, and never in a
  build argument (the route reads it at request time, so it does not need to
  exist during `next build`). Build/CI-only secrets: `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (source-map upload; never reaches
  the browser bundle since it is only read inside `next.config.ts` at build
  time).
- Verification: `POST /api/internal/sentry-verify`. Four runtime conditions,
  all required, none of them `NODE_ENV` (see `sentryVerifyGate.ts` for why):
  `APP_ENV` ∈ {`development`, `staging`, `preview`};
  `SENTRY_VERIFY_ENABLED=true`; `SENTRY_VERIFY_TOKEN` configured; and the
  request carrying that token in the `x-sentry-verify-token` header, compared
  in constant time after hashing both sides. POST rather than GET so a
  crawler, a prefetch or an unfurled link cannot fire it. Every refusal is
  the same empty 404, captures nothing, and reveals nothing about which
  condition failed; both answers carry `cache-control: no-store`. Success
  returns `{ "sent": boolean }` and nothing else.
  Covered by `src/app/api/internal/sentry-verify/route.test.ts` (16 cases per
  app, including production `APP_ENV`, unset/unlisted `APP_ENV`, missing and
  non-exact flag, missing/absent/wrong/prefix token, and a check that the
  token is never echoed back), and — because a unit test cannot see
  const-folding — by `scripts/verify-sentry-verify-route.sh`, which does a
  real `NODE_ENV=production` build and then supplies the runtime values only
  when the server starts.

## What's still unverified

No `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` were available in this environment.
Everything above was verified as code and configuration — unit tests,
`tsc --noEmit`, lint, and production builds with no DSN set (all four apps
run/build normally, confirming the "off unless configured" posture) — but
live event ingestion and resolved production stack traces from uploaded
source maps have **not** been confirmed against a real Sentry project.
Before relying on this in production: set the DSNs, run each app's
verification mechanism, and confirm the event arrives with a readable stack
trace. The operator-facing checklist for doing that — which Sentry projects
to create, which secret goes where, and the exact commands — is
`docs/SENTRY_STAGING_ACTIVATION_RU.md` (Russian).

Both verification gaps recorded there have since been closed (task #3):

- **admin/partner**: `POST /api/internal/sentry-verify`, gated at runtime on
  `APP_ENV` ∈ {development, staging, preview} **and**
  `SENTRY_VERIFY_ENABLED=true` **and** a `SENTRY_VERIFY_TOKEN` matching the
  `x-sentry-verify-token` request header, compared in constant time. No
  `NODE_ENV` anywhere in the gate — that is what made the old route a
  build-time constant. Every refusal is the same bodiless 404 with no-store
  headers, and captures nothing. Proven against a real production-mode build
  by `scripts/verify-sentry-verify-route.sh`.
- **mobile**: `src/diagnostics/sentryProbe.ts`, reachable only from the
  diagnostic overlay's `SENTRY` button, and only in a build where
  `extra.diagnostics === true` **and** `extra.appEnv` ∈ {preview, staging}.
  Nothing fires on startup; the probe captures and flushes without crashing
  the app or interrupting a flow.

The API's script (`node dist/scripts/sentry-verify.js` inside the container)
works and was exercised locally in both refusal paths.
