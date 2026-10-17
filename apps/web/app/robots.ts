import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3031';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$'],
        disallow: ['/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
