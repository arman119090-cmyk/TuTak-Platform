/**
 * Exact money on the phone.
 *
 * The platform keeps money as `Decimal(18, 4)`, and the server is the only
 * place a purchase's final figures are computed. What the app needs is a
 * *preview* the customer can trust while typing — and a preview computed
 * with `Number` is not one: `0.1 + 0.2` is the famous case, but
 * `Number('4999.9999') - Number('0.0001')` is the one that turns a valid
 * purchase into a red field. So amounts are scaled integers (BigInt, four
 * decimals), the same precision the server holds, and nothing here rounds
 * unless it says so in its name.
 *
 * Formatting for display is a separate concern (`presentation/utils/format`);
 * a value formatted for a screen must never be parsed back into arithmetic.
 */

export const MONEY_SCALE = 4;
const SCALE = 10n ** BigInt(MONEY_SCALE);

/** A money amount, scaled by 10^4. */
export type Money = bigint;

/**
 * Parses what a person typed. Accepts a plain decimal with up to four
 * fractional digits, comma or dot; rejects everything else, including empty
 * input — the caller decides what "nothing typed yet" means.
 */
export function parseMoney(input: string): Money | null {
  const cleaned = input.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(MONEY_SCALE, '0'));
}

/** The 4dp string the API speaks, e.g. `1234.5000`. */
export function moneyToString(value: Money): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(MONEY_SCALE, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export const ZERO: Money = 0n;

export function add(a: Money, b: Money): Money {
  return a + b;
}

export function subtract(a: Money, b: Money): Money {
  return a - b;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `percent` of `value`, rounded *down* to the 4th decimal. Used for the
 * partner's bonus-payment ceiling; rounding down means the preview never
 * claims a limit the server would refuse by a ten-thousandth.
 */
export function percentOfFloor(value: Money, percent: number): Money {
  if (!Number.isInteger(percent) || percent < 0) throw new Error('percent must be a non-negative integer');
  return (value * BigInt(percent)) / 100n;
}
