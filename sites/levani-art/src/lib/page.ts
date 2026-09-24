import { notFound } from 'next/navigation';
import { isLocale, locales, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getArtworks } from '@/content/catalog';
import { getArtist } from '@/content/artists';
import { normalizeForSearch, type SearchEntry } from './search';

export function localeParams() {
  return locales.map((locale) => ({ locale }));
}

/** Resolves the `[locale]` param or 404s. */
export async function resolveLocale(params: Promise<{ locale: string }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale: locale as Locale, dict: getDictionary(locale as Locale) };
}

export function buildSearchIndex(locale: Locale): SearchEntry[] {
  const dict = getDictionary(locale);
  const en = getDictionary('en');
  return getArtworks().map((a) => {
    const artist = getArtist(a.artistSlug)?.name ?? null;
    const category = dict.categories[a.category];
    return {
      slug: a.slug,
      title: a.title,
      artist,
      category,
      image: a.image.src,
      // English category names are indexed too: titles are in English, so
      // visitors often search in English whatever the interface language.
      text: normalizeForSearch(
        [a.title, artist, category, en.categories[a.category], a.dimensions].filter(Boolean).join(' '),
      ),
    };
  });
}
