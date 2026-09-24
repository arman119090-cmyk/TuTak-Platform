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

export type EmblemId = 'AM' | 'RU' | 'IT' | 'DE' | 'FR' | 'GB';

export const localeMeta: Record<
  Locale,
  { nativeName: string; emblem: EmblemId; htmlLang: string; ogLocale: string }
> = {
  hy: { nativeName: 'Հայերեն', emblem: 'AM', htmlLang: 'hy', ogLocale: 'hy_AM' },
  ru: { nativeName: 'Русский', emblem: 'RU', htmlLang: 'ru', ogLocale: 'ru_RU' },
  it: { nativeName: 'Italiano', emblem: 'IT', htmlLang: 'it', ogLocale: 'it_IT' },
  de: { nativeName: 'Deutsch', emblem: 'DE', htmlLang: 'de', ogLocale: 'de_DE' },
  fr: { nativeName: 'Français', emblem: 'FR', htmlLang: 'fr', ogLocale: 'fr_FR' },
  en: { nativeName: 'English', emblem: 'GB', htmlLang: 'en', ogLocale: 'en_GB' },
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
