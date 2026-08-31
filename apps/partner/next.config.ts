import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
// @ts-expect-error — plain ESM with JSDoc types; see the note at the top of
// that file for why a Next config cannot import the TypeScript sources.
import { securityHeaders } from '@tutak/design/security-headers';

const isDevelopment = process.env.NODE_ENV !== 'production';

const releaseSha = process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'unknown';

// Render's first staging blueprint uses a fixed public API hostname.
// `NEXT_PUBLIC_API_BASE_URL` is `sync: false` in render.yaml — an operator
// sets it by hand per service — so a service where it was never configured
// must not fall back to `localhost`, which the browser can never reach and
// which `connect-src`/`img-src` would then also lock the app out of the real
// API for (see apps/partner/src/lib/httpClient.ts for the client-side half of
// this fallback).
//
// The Dockerfile's own `ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1`
// means that when Render never forwards its dashboard value as a build arg,
// `process.env.NEXT_PUBLIC_API_BASE_URL` is still that exact literal here —
// never empty — so a plain `?? fallback` never reaches the staging fallback
// below. Checked against the literal instead of mere presence for the same
// reason httpClient.ts does.
//
// Can't branch on `APP_ENV` the way httpClient.ts branches on
// `window.location.hostname`: this whole module — and the `headers()` value
// it feeds — is evaluated once during `pnpm build` inside the Dockerfile's
// `build` stage (verified directly: `next start` afterwards, with `APP_ENV`
// set, still serves the header this module computed at build time), and
// `APP_ENV` is a Render *runtime* env var only — never declared as a Docker
// `ARG`, so it does not exist at that point. `NODE_ENV`, unlike `APP_ENV`, is
// a build-time-safe signal here: `next build` forces it to `'production'`
// internally regardless of the ambient shell, so `isDevelopment` is exactly
// "was this produced by `next build`" — true for a real `next dev` session
// (where the Dockerfile default is the genuinely correct answer), false for
// this Dockerfile's `build` stage. `render.yaml`'s own header comment scopes
// this whole blueprint to staging ("This blueprint is staging only"), so a
// production build landing here on the real staging API is exactly this
// deployment's one and only intended target.
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const apiBaseUrl =
  configuredApiBaseUrl && configuredApiBaseUrl !== 'http://localhost:4000/v1'
    ? configuredApiBaseUrl
    : isDevelopment
      ? 'http://localhost:4000/v1'
      : 'https://tutak-staging-api.onrender.com/v1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tutak/shared-types', '@tutak/design', '@tutak/observability'],
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: releaseSha,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          apiBaseUrl,
          // Without this the browser SDK is initialised, catches errors and
          // is then blocked by our own `connect-src` when it tries to send
          // one — the failure mode where the thing that would have told us
          // is the thing that broke.
          sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
          isDevelopment,
        }),
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // Initial staging deliberately does not generate or upload source maps.
  // Re-enable only through the separate CI task documented in
  // docs/SENTRY_SOURCEMAPS_FUTURE_RU.md, where the upload credential is
  // short-lived and never becomes a runtime environment variable.
  sourcemaps: {
    disable: true,
  },
  telemetry: false,
});
