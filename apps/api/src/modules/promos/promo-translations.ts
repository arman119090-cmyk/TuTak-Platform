import { Prisma } from '@prisma/client';

/**
 * The words on a Home "Partner Spotlight" card, per interface language.
 *
 * Kept as one pure module so the API's fallback, the admin panel's "which
 * languages are filled" indicator and the featured query all agree on what
 * a *filled* locale is: a title and a benefit label. A subtitle is optional
 * everywhere.
 *
 * Fallback order for a requested locale: the locale itself → `ru` → the
 * first filled locale in `PROMO_LOCALES` order. A card with no filled locale
 * resolves to `null` and is never served — see `PromosService.featured`.
 */
export const PROMO_LOCALES = ['hy', 'ru', 'en'] as const;
export type PromoLocale = (typeof PROMO_LOCALES)[number];

export const PROMO_FALLBACK_LOCALE: PromoLocale = 'ru';

export interface PromoCopy {
  title: string;
  subtitle?: string | null;
  benefitLabel: string;
}

export type PromoTranslations = Partial<Record<PromoLocale, PromoCopy>>;

export interface ResolvedPromoCopy extends PromoCopy {
  /** The locale the copy actually came from — the requested one, or a fallback. */
  locale: PromoLocale;
}

export function isPromoLocale(value: unknown): value is PromoLocale {
  return typeof value === 'string' && (PROMO_LOCALES as readonly string[]).includes(value);
}

/** A locale is filled when both required lines are present and non-blank. */
export function isFilled(copy: PromoCopy | undefined | null): copy is PromoCopy {
  return (
    !!copy &&
    typeof copy.title === 'string' &&
    copy.title.trim().length > 0 &&
    typeof copy.benefitLabel === 'string' &&
    copy.benefitLabel.trim().length > 0
  );
}

/** Reads the JSON column defensively: anything that is not an object is "nothing filled". */
export function readTranslations(raw: Prisma.JsonValue | null | undefined): PromoTranslations {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PromoTranslations = {};
  for (const locale of PROMO_LOCALES) {
    const copy = (raw as Record<string, unknown>)[locale];
    if (copy && typeof copy === 'object' && !Array.isArray(copy)) {
      const c = copy as Record<string, unknown>;
      out[locale] = {
        title: typeof c.title === 'string' ? c.title : '',
        subtitle: typeof c.subtitle === 'string' ? c.subtitle : null,
        benefitLabel: typeof c.benefitLabel === 'string' ? c.benefitLabel : '',
      };
    }
  }
  return out;
}

export function availableLocales(translations: PromoTranslations): PromoLocale[] {
  return PROMO_LOCALES.filter((locale) => isFilled(translations[locale]));
}

export function resolvePromoCopy(
  translations: PromoTranslations,
  requested: PromoLocale | string | undefined,
): ResolvedPromoCopy | null {
  const order: PromoLocale[] = [];
  if (isPromoLocale(requested)) order.push(requested);
  order.push(PROMO_FALLBACK_LOCALE, ...PROMO_LOCALES);
  for (const locale of order) {
    const copy = translations[locale];
    if (isFilled(copy)) {
      return {
        locale,
        title: copy.title.trim(),
        subtitle: copy.subtitle?.trim() || null,
        benefitLabel: copy.benefitLabel.trim(),
      };
    }
  }
  return null;
}

/** Trims and drops empty locales before the JSON is written. */
export function normaliseTranslations(input: PromoTranslations): PromoTranslations {
  const out: PromoTranslations = {};
  for (const locale of PROMO_LOCALES) {
    const copy = input[locale];
    if (!copy) continue;
    const title = (copy.title ?? '').trim();
    const subtitle = (copy.subtitle ?? '').trim();
    const benefitLabel = (copy.benefitLabel ?? '').trim();
    if (!title && !subtitle && !benefitLabel) continue;
    out[locale] = { title, subtitle: subtitle || null, benefitLabel };
  }
  return out;
}
