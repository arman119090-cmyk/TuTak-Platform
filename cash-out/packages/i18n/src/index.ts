import { en } from './locales/en';
import { hy } from './locales/hy';
import { ru } from './locales/ru';
import { DEFAULT_LOCALE, Locale, Translations } from './types';

export * from './types';
export * from './format';
export { en, hy, ru };

export const translations: Readonly<Record<Locale, Translations>> = {
  hy,
  ru,
  en: en as unknown as Translations,
};

type Section = keyof Translations;

export type TranslationKey = {
  [S in Section]: `${S & string}.${keyof Translations[S] & string}`;
}[Section];

export type InterpolationValues = Record<string, string | number>;

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * Looks up `key` in `locale`, falling back to the default locale and finally to
 * the key itself. A missing key never throws in front of a driver; it is
 * reported by the completeness test instead, which is where a missing string
 * should be caught.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  values: InterpolationValues = {},
): string {
  const template = lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key) ?? key;
  return interpolate(template, values);
}

export function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

function lookup(locale: Locale, key: string): string | undefined {
  const [section, leaf] = key.split('.') as [Section, string];
  const bucket = translations[locale][section] as Record<string, string> | undefined;
  return bucket?.[leaf];
}

/** Binds a locale once, for components that translate many keys. */
export function createTranslator(locale: Locale) {
  return (key: TranslationKey, values?: InterpolationValues) => translate(locale, key, values);
}

export type Translator = ReturnType<typeof createTranslator>;
