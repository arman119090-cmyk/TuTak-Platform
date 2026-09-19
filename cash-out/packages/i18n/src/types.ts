import type { TranslationTree } from './locales/en';

/**
 * The English tree, flattened to `string` leaves. Every other locale is typed
 * against this, so adding a key in English without translating it is a
 * compile-time failure rather than an English string on an Armenian screen.
 */
export type Translations = {
  [Section in keyof TranslationTree]: {
    [Key in keyof TranslationTree[Section]]: string;
  };
};

export const LOCALES = ['hy', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Armenian first: it is the language of the market the product launches in. */
export const DEFAULT_LOCALE: Locale = 'hy';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Maps our short locale codes to the BCP 47 tags `Intl` expects. */
export const INTL_LOCALES: Readonly<Record<Locale, string>> = {
  hy: 'hy-AM',
  ru: 'ru-RU',
  en: 'en-US',
};
