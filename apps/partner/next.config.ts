import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
// @ts-expect-error — plain ESM with JSDoc types; see the note at the top of
// that file for why a Next config cannot import the TypeScript sources.
import { securityHeaders } from '@tutak/design/security-headers';

const isDevelopment = process.env.NODE_ENV !== 'production';

// Same deterministic release convention as apps/api and apps/mobile. Inlined
// here rather than imported from @tutak/observability's resolveReleaseSha for
// the same reason securityHeaders is plain JS above: next.config.ts is loaded
// by Node before workspace TypeScript sources can be resolved. Exposed as
// NEXT_PUBLIC_SENTRY_RELEASE so it reaches the client, server, and edge
// Sentry configs identically (see src/lib/observability/sentryOptions.ts).
const releaseSha = process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'unknown';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tutak/shared-types', '@tutak/design', '@tutak/observability'],
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: releaseSha,
  },

  // See the admin dashboard's config and the shared module for the reasoning.
  // Both dashboards deliberately share one policy: they hold the same kind of
  // session and differ only in who is signed in.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/v1',
          isDevelopment,
        }),
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // Source maps are uploaded to Sentry during the build and then removed from
  // the output directory, so they are never served to the public — the SDK
  // does not add a `//# sourceMappingURL` comment pointing at them either.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  telemetry: false,
});
