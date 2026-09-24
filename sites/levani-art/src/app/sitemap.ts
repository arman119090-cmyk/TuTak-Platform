import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';
import { getArtworks, getPopulatedCategories } from '@/content/catalog';
import { i18nConfig, localeMeta, locales } from '@/i18n/config';
import { pageUrl } from '@/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    '',
    '/collection',
    ...getPopulatedCategories().map((c) => `/collection/${c}`),
    ...getArtworks().map((a) => `/artworks/${a.slug}`),
    '/artists',
    '/about',
    '/private-clients',
    '/enquire',
  ];
  // Every locale URL is listed, each carrying the full set of alternates.
  return paths.flatMap((path) => {
    const languages: Record<string, string> = {};
    for (const l of locales) languages[localeMeta[l].htmlLang] = pageUrl(l, path);
    languages['x-default'] = pageUrl(i18nConfig.defaultLocale, path);
    return locales.map((l) => ({ url: pageUrl(l, path), alternates: { languages } }));
  });
}
