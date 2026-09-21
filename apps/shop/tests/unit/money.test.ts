import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  convert,
  discountPercent,
  formatMoney,
  multiplyMoney,
  percentOf,
} from '@/lib/money';

describe('money', () => {
  it('formats AMD with a group separator and a suffixed symbol', () => {
    expect(formatMoney(1_250_000)).toBe('1 250 000 ֏');
    expect(formatMoney(900)).toBe('900 ֏');
  });

  it('formats a two-exponent currency with decimals', () => {
    expect(formatMoney(129_900, 'USD')).toBe('$1 299.00');
  });

  it('keeps AMD at exponent 0 so a minor unit is one dram', () => {
    expect(CURRENCIES.AMD.exponent).toBe(0);
  });

  it('rounds a percentage discount half-up on the minor unit', () => {
    expect(percentOf(999, 10)).toBe(100);
    expect(percentOf(1000, 15)).toBe(150);
  });

  it('never reports a discount when the new price is not lower', () => {
    expect(discountPercent(1000, 1000)).toBe(0);
    expect(discountPercent(0, 500)).toBe(0);
    expect(discountPercent(1000, 800)).toBe(20);
  });

  it('floors the discount percentage so it cannot oversell', () => {
    // 1000 -> 801 is 19.9%; showing 20% would overstate the saving.
    expect(discountPercent(1000, 801)).toBe(19);
  });

  it('multiplies by an integer quantity without floats', () => {
    expect(multiplyMoney({ amount: 33_333, currency: 'AMD' }, 3).amount).toBe(99_999);
  });

  it('converts between currencies and back within rounding tolerance', () => {
    const usd = convert(1_000_000, 'AMD', 'USD');
    expect(usd).toBeGreaterThan(0);
    const back = convert(usd, 'USD', 'AMD');
    expect(Math.abs(back - 1_000_000)).toBeLessThan(20_000);
  });

  it('returns integers for every conversion', () => {
    for (const currency of ['USD', 'EUR', 'RUB'] as const) {
      expect(Number.isInteger(convert(123_456, 'AMD', currency))).toBe(true);
    }
  });
});
