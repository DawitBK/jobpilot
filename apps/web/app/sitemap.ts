import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3031';

/** Only the landing page is public; everything else is a private workspace. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 }];
}
