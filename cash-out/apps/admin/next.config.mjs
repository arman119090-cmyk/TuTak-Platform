/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The admin panel renders on the server and talks to the API with the
  // operator's session cookie; nothing is statically exported.
  output: 'standalone',
  transpilePackages: ['@cashout/design-tokens', '@cashout/contracts'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
