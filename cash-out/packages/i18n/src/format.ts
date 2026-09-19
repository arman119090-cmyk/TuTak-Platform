import { INTL_LOCALES, Locale } from './types';

export interface MoneyLike {
  readonly minor: string;
  readonly currency: string;
}

const EXPONENTS: Readonly<Record<string, number>> = {
  AMD: 2,
  RUB: 2,
  USD: 2,
  EUR: 2,
  GEL: 2,
  KZT: 2,
};

function exponentFor(currency: string): number {
  return EXPONENTS[currency] ?? 2;
}

/**
 * Converts integer minor units to a decimal string without ever going through a
 * JavaScript number.
 */
export function minorToDecimalString(minor: string, currency: string): string {
  const exponent = exponentFor(currency);
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).replace(/^\+/, '');
  if (exponent === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, padded.length - exponent);
  const fraction = padded.slice(padded.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export interface FormatMoneyOptions {
  /** Hide the trailing ".00" that no driver reads. Default: true for whole amounts. */
  readonly hideZeroFraction?: boolean;
  /** Render the currency symbol. Default: true. */
  readonly showCurrency?: boolean;
  /** Always render a leading + or −. Used in the ledger view. */
  readonly signDisplay?: 'auto' | 'always' | 'never';
}

/**
 * Formats money for display.
 *
 * `Intl.NumberFormat` is fed the exact decimal *string*, not a number: an
 * AMD balance of 92 233 720 368 547 758.07 is representable as a string and as
 * a bigint, and not as an IEEE double. Nothing in this product ever converts an
 * amount to a `number`.
 */
export function formatMoney(
  amount: MoneyLike,
  locale: Locale,
  options: FormatMoneyOptions = {},
): string {
  const { showCurrency = true, signDisplay = 'auto' } = options;
  const decimal = minorToDecimalString(amount.minor, amount.currency);
  const exponent = exponentFor(amount.currency);
  const isWhole = exponent === 0 || /\.0+$/.test(decimal);
  const hideZeroFraction = options.hideZeroFraction ?? true;
  const fractionDigits = hideZeroFraction && isWhole ? 0 : exponent;

  const formatter = new Intl.NumberFormat(INTL_LOCALES[locale], {
    style: showCurrency ? 'currency' : 'decimal',
    currency: showCurrency ? amount.currency : undefined,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    signDisplay: signDisplay === 'never' ? 'never' : signDisplay,
  });

  return formatter.format(decimal as unknown as number);
}

/** The amount alone, for the hero balance where the currency sits beside it. */
export function formatAmountOnly(amount: MoneyLike, locale: Locale): string {
  return formatMoney(amount, locale, { showCurrency: false });
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], { timeStyle: 'short' }).format(
    new Date(iso),
  );
}
