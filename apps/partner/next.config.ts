import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tutak/shared-types', '@tutak/i18n', '@tutak/design'],
};

export default nextConfig;
