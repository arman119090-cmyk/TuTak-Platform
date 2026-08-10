import en from './locales/en.json';
import ru from './locales/ru.json';
import hy from './locales/hy.json';

export const SUPPORTED_LOCALES = ['hy', 'ru', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'hy';

/** i18next-compatible resource bundle: { [locale]: { translation: {...} } } */
export const i18nResources = {
  en: { translation: en },
  ru: { translation: ru },
  hy: { translation: hy },
} as const;

export const translations = { en, ru, hy };

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
