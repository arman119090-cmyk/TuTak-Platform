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

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The financial key for a unit of measure, and its label.
 *
 * `UnitOfMeasure` is an enum in the database because it is compared for
 * equality to decide whether a per-unit margin may be multiplied by a
 * quantity — "L" and "л" being different units is a wrong invoice, not a
 * display problem. The *label* is the opposite kind of value: it changes with
 * who is reading, and it must never be what the arithmetic compares.
 *
 * So the labels live here, in the shared translation layer, keyed by the enum
 * value. Nothing in `apps/api` imports them, and nothing should: a service
 * that formatted a unit for display would be a service that could be asked
 * to parse one back.
 */
export const UNIT_OF_MEASURE_KEYS = ['LITER', 'KWH', 'KILOGRAM', 'ITEM', 'HOUR'] as const;
export type UnitOfMeasureKey = (typeof UNIT_OF_MEASURE_KEYS)[number];

/** `unitOfMeasure.LITER` — the i18next key a client passes to `t()`. */
export function unitLabelKey(unit: UnitOfMeasureKey): string {
  return `unitOfMeasure.${unit}`;
}

/**
 * The label directly, for a client with no i18next runtime.
 *
 * The partner dashboard is English-only and has no translation machinery;
 * giving it one just to render "L" would be inventing a subsystem. This keeps
 * the labels where §8 requires — in the shared layer, keyed by the financial
 * enum — while letting a plain React app read one.
 *
 * Falls back to the key rather than to another locale's label: a missing
 * translation should look wrong, not quietly become English.
 */
export function unitLabel(unit: UnitOfMeasureKey, locale: SupportedLocale = DEFAULT_LOCALE): string {
  const bundle = i18nResources[locale].translation as { unitOfMeasure?: Record<string, string> };
  return bundle.unitOfMeasure?.[unit] ?? unit;
}
