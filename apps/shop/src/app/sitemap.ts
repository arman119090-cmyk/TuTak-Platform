import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { siteUrl } from '@/config/brand';
import { LOCALES } from '@/lib/i18n';
import { CONTENT_PAGES } from '@/data/content-pages';

/**
 * Sitemap covering all three language versions of every indexable URL.
 * Private pages (cart, checkout, account) are excluded on purpose.
 */
const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
  const [categories, products] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const entry = (
    path: string,
    lastModified: Date,
    priority: number,
  ): MetadataRoute.Sitemap[number] => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency: 'weekly',
    priority,
    alternates: {
      languages: Object.fromEntries(
        LOCALES.map((locale) => [locale, `${siteUrl}/${locale}${path.replace(/^\/[a-z]{2}/, '')}`]),
      ),
    },
  });

  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of LOCALES) {
    entries.push(entry(`/${locale}`, now, 1));
    entries.push(entry(`/${locale}/catalog`, now, 0.9));
    entries.push(entry(`/${locale}/kitchens`, now, 0.8));
    for (const category of categories) {
      entries.push(entry(`/${locale}/catalog/${category.slug}`, category.updatedAt, 0.8));
    }
    for (const page of CONTENT_PAGES) {
      entries.push(entry(`/${locale}/pages/${page.slug}`, now, 0.4));
    }
    for (const product of products) {
      entries.push(entry(`/${locale}/product/${product.slug}`, product.updatedAt, 0.7));
    }
  }

  return entries;
};

export default sitemap;
