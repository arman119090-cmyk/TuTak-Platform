import type { NextConfig } from 'next';
// @ts-expect-error — plain ESM with JSDoc types; see the note at the top of
// that file for why a Next config cannot import the TypeScript sources.
import { securityHeaders } from '@tutak/design/security-headers';

const isDevelopment = process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tutak/shared-types', '@tutak/design'],

  // The API sends a full set of these through helmet and this app sent none —
  // which is backwards, because the operator session and the access token in
  // `localStorage` live here, not there. What the policy does and does not
  // buy is written out in the shared module.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          // Must match what the client bundle was built to call, or every
          // request the dashboard makes is blocked by `connect-src`.
          apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/v1',
          isDevelopment,
        }),
      },
    ];
  },
};

export default nextConfig;
