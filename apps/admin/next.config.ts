import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
// @ts-expect-error — plain ESM with JSDoc types; see the note at the top of
// that file for why a Next config cannot import the TypeScript sources.
import { securityHeaders } from '@tutak/design/security-headers';
// @ts-expect-error — plain ESM with JSDoc types, for the same reason.
import { resolveApiBaseUrl } from './api-base-url.mjs';

const isDevelopment = process.env.NODE_ENV !== 'production';

const releaseSha = process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'unknown';

// Which API this build may talk to, and therefore what `connect-src` names.
//
// Resolved through the shared helper so that the policy computed here and the
// address `src/lib/httpClient.ts` actually calls cannot drift apart. Reading
// the environment variable directly was wrong on Render, where it is a runtime
// value and never reaches this build: the policy named localhost and the
// dashboard's own requests to the staging API were refused. See
// api-base-url.mjs.
//
// `headers()` is evaluated once during `pnpm build` inside the Dockerfile's
// `build` stage, so only build-time inputs exist here; `NODE_ENV` is one
// (`next build` forces it to `'production'`), `APP_ENV` is not.
const apiBaseUrl = resolveApiBaseUrl({
  configured: process.env.NEXT_PUBLIC_API_BASE_URL,
  isDevelopment,
});

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
