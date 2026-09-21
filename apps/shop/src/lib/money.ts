/**
 * Money handling.
 *
 * Every amount in this codebase is an integer number of minor units together
 * with a currency code. Floats are never used for money: `0.1 + 0.2` problems
 * do not get to touch an order total.
 *
 * AMD (Armenian dram) has no sub-unit in circulation, so its exponent is 0 and
 * one minor unit is one dram. Other currencies are already supported by the
 * formatter and the rate table, which is what "architecturally ready for other
 * currencies" means here.
 */

export type CurrencyCode = 'AMD' | 'USD' | 'EUR' | 'RUB';

export type Currency = {
  code: CurrencyCode;
  /** Number of decimal digits in the minor unit (AMD = 0, USD = 2). */
  exponent: number;
  symbol: string;
  /** Symbol position for the default locale rendering. */
  position: 'prefix' | 'suffix';
};

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  AMD: { code: 'AMD', exponent: 0, symbol: '֏', position: 'suffix' },
  USD: { code: 'USD', exponent: 2, symbol: '$', position: 'prefix' },
  EUR: { code: 'EUR', exponent: 2, symbol: '€', position: 'prefix' },
  RUB: { code: 'RUB', exponent: 2, symbol: '₽', position: 'suffix' },
};

export const BASE_CURRENCY: CurrencyCode = 'AMD';

/**
 * Indicative conversion rates from the base currency, expressed as
 * "minor units of the target per 1000 minor units of AMD" to keep the maths in
 * integers. Demo values; a real deployment reads these from a rate provider.
 */
const RATE_PER_1000_AMD: Record<CurrencyCode, number> = {
  AMD: 1000,
  USD: 260,
  EUR: 240,
  RUB: 21000,
};

export type Money = { amount: number; currency: CurrencyCode };

export const money = (amount: number, currency: CurrencyCode = BASE_CURRENCY): Money => ({
  amount: Math.round(amount),
  currency,
});

export const addMoney = (a: Money, b: Money): Money => {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency}/${b.currency}`);
  return { amount: a.amount + b.amount, currency: a.currency };
};

/** Multiplies by an integer quantity. Kept explicit so no float sneaks in. */
export const multiplyMoney = (a: Money, quantity: number): Money => ({
  amount: a.amount * Math.round(quantity),
  currency: a.currency,
});

/**
 * Applies a percentage discount and rounds half-up on the minor unit, which is
 * the rounding a customer expects to see on a receipt.
 */
export const percentOf = (amountMinor: number, percent: number): number =>
  Math.round((amountMinor * percent) / 100);

export const convert = (amountMinor: number, from: CurrencyCode, to: CurrencyCode): number => {
  if (from === to) return amountMinor;
  const fromCurrency = CURRENCIES[from];
  const toCurrency = CURRENCIES[to];
  const inAmd =
    from === 'AMD'
      ? amountMinor
      : Math.round((amountMinor * 1000) / RATE_PER_1000_AMD[from]) *
        10 ** (CURRENCIES.AMD.exponent - fromCurrency.exponent);
  const converted = Math.round((inAmd * RATE_PER_1000_AMD[to]) / 1000);
  return Math.round(converted * 10 ** (toCurrency.exponent - CURRENCIES.AMD.exponent));
};

const GROUP_SEPARATOR = ' '; // narrow no-break space: 1 250 000 ֏

/**
 * Formats minor units for display. Deliberately not `Intl.NumberFormat` with a
 * currency style: that renders AMD as "AMD 1,250,000" in several locales,
 * while Armenian shops write "1 250 000 ֏".
 */
export const formatMoney = (
  amountMinor: number,
  currency: CurrencyCode = BASE_CURRENCY,
  options: { withSymbol?: boolean } = {},
): string => {
  const { withSymbol = true } = options;
  const meta = CURRENCIES[currency];
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const major = Math.floor(absolute / 10 ** meta.exponent);
  const minor = absolute % 10 ** meta.exponent;
  const majorText = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  const minorText = meta.exponent > 0 ? `.${String(minor).padStart(meta.exponent, '0')}` : '';
  const number = `${negative ? '−' : ''}${majorText}${minorText}`;
  if (!withSymbol) return number;
  return meta.position === 'prefix'
    ? `${meta.symbol}${number}`
    : `${number}${GROUP_SEPARATOR}${meta.symbol}`;
};

/** Discount percentage from an old/new price pair, floored (never oversells). */
export const discountPercent = (oldPriceMinor: number, priceMinor: number): number => {
  if (oldPriceMinor <= 0 || priceMinor >= oldPriceMinor) return 0;
  return Math.floor(((oldPriceMinor - priceMinor) / oldPriceMinor) * 100);
};
