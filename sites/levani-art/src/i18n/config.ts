/**
 * Every locale decision of the site lives here — the supported set, the
 * fallback, whether the browser language is consulted on a first visit and
 * where a manual choice is remembered. Change behaviour in this file only.
 */
export const locales = ['hy', 'ru', 'it', 'de', 'fr', 'en'] as const;
export type Locale = (typeof locales)[number];

export const i18nConfig = {
  defaultLocale: 'en' as Locale,
  /** First visit: use Accept-Language when it names a supported locale. */
  detectBrowserLanguage: true,
  /** Remember the visitor's manual choice in a cookie. */
  persistManualSelection: true,
  cookieName: 'LEVANI_LOCALE',
  cookieMaxAgeSeconds: 60 * 60 * 24 * 365,
} as const;

/** File name in public/flags; English uses the United Kingdom's flag. */
export type FlagId = 'am' | 'ru' | 'it' | 'de' | 'fr' | 'gb';

export const localeMeta: Record<
  Locale,
  { nativeName: string; flag: FlagId; htmlLang: string; ogLocale: string }
> = {
  hy: { nativeName: 'Հայերեն', flag: 'am', htmlLang: 'hy', ogLocale: 'hy_AM' },
  ru: { nativeName: 'Русский', flag: 'ru', htmlLang: 'ru', ogLocale: 'ru_RU' },
  it: { nativeName: 'Italiano', flag: 'it', htmlLang: 'it', ogLocale: 'it_IT' },
  de: { nativeName: 'Deutsch', flag: 'de', htmlLang: 'de', ogLocale: 'de_DE' },
  fr: { nativeName: 'Français', flag: 'fr', htmlLang: 'fr', ogLocale: 'fr_FR' },
  en: { nativeName: 'English', flag: 'gb', htmlLang: 'en', ogLocale: 'en_GB' },
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
