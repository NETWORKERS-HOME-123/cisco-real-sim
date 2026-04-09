/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_EXPORT === '1';

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  ...(isExport ? { output: 'export' } : {}),
  typescript: {
    ignoreBuildErrors: false,
  },
  ...(!isExport ? {
    async rewrites() {
      return [
        { source: '/api/:path*', destination: 'http://localhost:3000/api/:path*' },
        { source: '/ws', destination: 'http://localhost:3000/ws' },
      ];
    },
  } : {}),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
