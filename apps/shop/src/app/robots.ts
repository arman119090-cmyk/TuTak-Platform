import type { MetadataRoute } from 'next';
import { siteUrl } from '@/config/brand';

const robots = (): MetadataRoute.Robots => ({
  rules: [
    {
      userAgent: '*',
      allow: '/',
      // Nothing private or duplicate-prone belongs in an index.
      disallow: ['/api/', '/admin', '/*/cart', '/*/checkout', '/*/account', '/*/search'],
    },
  ],
  sitemap: `${siteUrl}/sitemap.xml`,
  host: siteUrl,
});

export default robots;
