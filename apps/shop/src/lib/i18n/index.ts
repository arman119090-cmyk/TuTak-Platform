import { hy } from './hy';
import { en } from './en';
import { ru, type Dictionary } from './ru';

export const LOCALES = ['hy', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale =
  (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale | undefined) ?? 'ru';

const DICTIONARIES: Record<Locale, Dictionary> = { hy, ru, en };

export const isLocale = (value: string | undefined | null): value is Locale =>
  !!value && (LOCALES as readonly string[]).includes(value);

export const getDictionary = (locale: Locale): Dictionary => DICTIONARIES[locale];

export type { Dictionary };

/**
 * Substitutes `{placeholders}` in a translated string.
 *
 * Templates live in the dictionaries, so translators keep control of word order
 * — "{qty} pcs in stock" and "Պահեստում՝ {qty} հատ" are both natural.
 */
export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );

/** BCP-47 tag for Intl APIs and the <html lang> attribute. */
export const htmlLang = (locale: Locale): string =>
  locale === 'hy' ? 'hy-AM' : locale === 'en' ? 'en' : 'ru';

/** Picks the best supported locale from an Accept-Language header. */
export const negotiateLocale = (acceptLanguage: string | null): Locale => {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
};

/** Rewrites a path to another locale, preserving the rest of the URL. */
export const localizePath = (path: string, locale: Locale): string => {
  const [pathname = '/', query] = path.split('?');
  const segments = pathname.split('/').filter(Boolean);
  if (isLocale(segments[0])) segments[0] = locale;
  else segments.unshift(locale);
  return `/${segments.join('/')}${query ? `?${query}` : ''}`;
};
