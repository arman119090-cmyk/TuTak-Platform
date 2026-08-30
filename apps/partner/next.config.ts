import type { NextConfig } from 'next';
// @ts-expect-error — plain ESM with JSDoc types; see the note at the top of
// that file for why a Next config cannot import the TypeScript sources.
import { securityHeaders } from '@tutak/design/security-headers';

const isDevelopment = process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tutak/shared-types', '@tutak/design'],

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

export default nextConfig;
