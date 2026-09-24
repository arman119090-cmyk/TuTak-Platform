import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // No runtime optimizer: every width is pre-rendered at build time by
    // scripts/build-images.mjs (see the note there on why).
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
    // Source photography is ~709 px wide; larger candidates would only be
    // upscaled copies, so the ladder stops at the source width. Keep in sync
    // with WIDTHS in scripts/build-images.mjs.
    deviceSizes: [360, 480, 640, 750],
    imageSizes: [96, 160, 240, 320],
  },
  async headers() {
    return [
      {
        // Variants are regenerated only when a source changes; the file name
        // stays, so a day of caching, not a year.
        source: '/artworks/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
