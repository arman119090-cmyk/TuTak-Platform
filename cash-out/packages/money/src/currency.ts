/**
 * Currency registry.
 *
 * `exponent` is the ISO 4217 minor-unit exponent: the number of decimal places a
 * currency amount has when written out. All Cash Out amounts are stored and
 * transported as integer minor units together with the currency code, so this
 * table is the single place that maps between the two representations.
 *
 * `minorIncrement` is the smallest number of minor units a *payout* may move.
 * It is a property of the payment rail rather than of the currency itself, so it
 * can be overridden per payment provider in configuration; the value here is the
 * conservative default.
 */

export const CURRENCIES = {
  AMD: { code: 'AMD', exponent: 2, minorIncrement: 1n, numeric: '051' },
  RUB: { code: 'RUB', exponent: 2, minorIncrement: 1n, numeric: '643' },
  USD: { code: 'USD', exponent: 2, minorIncrement: 1n, numeric: '840' },
  EUR: { code: 'EUR', exponent: 2, minorIncrement: 1n, numeric: '978' },
  GEL: { code: 'GEL', exponent: 2, minorIncrement: 1n, numeric: '981' },
  KZT: { code: 'KZT', exponent: 2, minorIncrement: 1n, numeric: '398' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export interface Currency {
  readonly code: CurrencyCode;
  readonly exponent: number;
  readonly minorIncrement: bigint;
  readonly numeric: string;
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function getCurrency(code: CurrencyCode): Currency {
  const currency = CURRENCIES[code];
  if (!currency) {
    throw new RangeError(`getCurrency: unsupported currency ${String(code)}`);
  }
  return currency;
}

/** 10 ** exponent, as a bigint. */
export function minorUnitScale(code: CurrencyCode): bigint {
  return 10n ** BigInt(getCurrency(code).exponent);
}
