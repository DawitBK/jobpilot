import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  // The workspace has more than one lockfile on some machines; pin the root so tracing stays inside the repo.
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  poweredByHeader: false,
  // Development only: Next blocks its dev resources (including hot reload) for any address other than
  // localhost. Opening the app on 127.0.0.1 needs it listed. DEV_ORIGINS is a comma-separated list.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? '127.0.0.1').split(',').map((o) => o.trim()),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
