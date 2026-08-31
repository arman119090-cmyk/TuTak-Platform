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
const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.APP_ENV === 'staging'
    ? 'https://tutak-staging-api.onrender.com/v1'
    : 'http://localhost:4000/v1');

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
