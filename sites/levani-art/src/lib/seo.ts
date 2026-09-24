import type { Metadata } from 'next';
import { i18nConfig, localeMeta, locales, type Locale } from '@/i18n/config';
import { site } from '@/content/site';
import { siteUrl } from './site-url';

/** `path` is locale-less and starts with `/` (or is '' for home). */
export function localizedAlternates(locale: Locale, path: string): Metadata['alternates'] {
  const languages: Record<string, string> = {};
  for (const l of locales) languages[localeMeta[l].htmlLang] = `${siteUrl()}/${l}${path}`;
  languages['x-default'] = `${siteUrl()}/${i18nConfig.defaultLocale}${path}`;
  return { canonical: `${siteUrl()}/${locale}${path}`, languages };
}

export function pageMetadata(args: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  image?: { src: string; width: number; height: number; alt: string };
}): Metadata {
  const { locale, path, title, description, image } = args;
  const fullTitle = title === site.brandName ? title : `${title} — ${site.brandName}`;
  const images = image
    ? [{ url: `${siteUrl()}${image.src}`, width: image.width, height: image.height, alt: image.alt }]
    : undefined;
  return {
    title: fullTitle,
    description,
    alternates: localizedAlternates(locale, path),
    openGraph: {
      type: 'website',
      siteName: site.brandName,
      title: fullTitle,
      description,
      url: `${siteUrl()}/${locale}${path}`,
      locale: localeMeta[locale].ogLocale,
      alternateLocale: locales.filter((l) => l !== locale).map((l) => localeMeta[l].ogLocale),
      images,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: fullTitle,
      description,
      images: images?.map((i) => i.url),
    },
  };
}
