import type { Locale } from '@/i18n/config';
import type { LocalizedText, Price } from './types';

export function localized(text: LocalizedText | null, locale: Locale): string | null {
  if (!text) return null;
  return text[locale] ?? text.en;
}

export function formatPrice(price: Price, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
    maximumFractionDigits: 0,
  }).format(price.amount);
}
