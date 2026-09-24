import hy from './hy.json';
import ru from './ru.json';
import en from './en.json';

export const locales = ['hy', 'ru', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'hy';

export type Dict = typeof ru;

// Типизация по русскому словарю — он исходный (BRIEF.md, п. 10). Если в hy/en
// не хватит ключа, `astro check` упадёт на этом присваивании.
const dicts: Record<Locale, Dict> = { hy, ru, en };

export function t(locale: Locale): Dict {
  return dicts[locale];
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Подписи переключателя языков — как в BRIEF.md: ՀՅ / RU / EN. */
export const localeLabels: Record<Locale, { short: string; name: string }> = {
  hy: { short: 'ՀՅ', name: 'Հայերեն' },
  ru: { short: 'RU', name: 'Русский' },
  en: { short: 'EN', name: 'English' },
};

/** Значения для hreflang / og:locale. */
export const localeTags: Record<Locale, { hreflang: string; og: string }> = {
  hy: { hreflang: 'hy', og: 'hy_AM' },
  ru: { hreflang: 'ru', og: 'ru_RU' },
  en: { hreflang: 'en', og: 'en_US' },
};
