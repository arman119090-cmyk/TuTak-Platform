import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Fully static site: every page is pre-rendered to HTML in out/ and served
  // by a CDN (Render Static Site). No Node server, nothing to fall asleep.
  // Locale detection on "/" is done by public/index.html; security and cache
  // headers are set on the host (see README "Deployment").
  output: 'export',
  // /en/collection/ → out/en/collection/index.html: resolves on any static host.
  trailingSlash: true,
  reactStrictMode: true,
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
};

export default nextConfig;
