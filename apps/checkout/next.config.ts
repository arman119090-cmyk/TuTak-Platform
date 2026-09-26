import type { NextConfig } from 'next';
// @ts-expect-error — plain ESM with JSDoc types (a Next config cannot import TypeScript sources).
import { securityHeaders } from '@tutak/design/security-headers';
// @ts-expect-error — plain ESM with JSDoc types, for the same reason.
import { resolveApiBaseUrl } from './api-base-url.mjs';

const isDevelopment = process.env.NODE_ENV !== 'production';
const apiBaseUrl = resolveApiBaseUrl({ configured: process.env.NEXT_PUBLIC_API_BASE_URL, isDevelopment });

/**
 * TuTak Web Checkout (Q12). Deliberately lightweight: no dashboard shell, no
 * Sentry bundle — a customer opening a checkout link from a partner's site
 * should get the page fast. Same security headers as every TuTak web app.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tutak/shared-types', '@tutak/design', '@tutak/i18n'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders({ apiBaseUrl, isDevelopment }) }];
  },
};

export default nextConfig;
