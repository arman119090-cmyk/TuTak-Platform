import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  MONEY_MAX,
  parseMoney,
  parsePositiveMoney,
  sumDecimals,
  toDecimal,
} from './money';

/**
 * parseMoney is the chokepoint every externally-supplied amount passes
 * through. Each rejected case below corresponds to a value that reached the
 * bonus arithmetic before this function existed.
 */
describe('parseMoney', () => {
  describe('rejects values that broke the bonus maths', () => {
    // The original exploit: a negative bonus turned `amount.minus(bonus)`
    // into an addition, inflating the accrual base without limit.
    it.each(['-1', '-0.0001', '-1000000', -5, new Decimal('-0.0001')])(
      'rejects negative %p',
      (value) => {
        expect(() => parseMoney(value as never, 'amount')).toThrow(BadRequestException);
        expect(() => parseMoney(value as never, 'amount')).toThrow(/must not be negative/);
      },
    );

    it.each(['NaN', NaN])('rejects NaN %p', (value) => {
      expect(() => parseMoney(value as never, 'amount')).toThrow(BadRequestException);
    });

    it.each(['Infinity', '-Infinity', Infinity, -Infinity])('rejects %p', (value) => {
      expect(() => parseMoney(value as never, 'amount')).toThrow(BadRequestException);
    });

    it('rejects a value that exceeds the Decimal(18,4) column', () => {
      expect(() => parseMoney('100000000000000', 'amount')).toThrow(/exceeds the maximum/);
      // 1e40 in exponential form is the same attack wearing a different hat.
      expect(() => parseMoney('1e40', 'amount')).toThrow(/exceeds the maximum/);
    });

    it('rejects more precision than the column can store', () => {
      // Silently rounding here would let 0.00005 accumulate into free points
      // across many operations, or lose a fraction of every redemption.
      expect(() => parseMoney('1.00005', 'amount')).toThrow(/at most 4 decimal places/);
    });

    it('rejects non-numeric text', () => {
      expect(() => parseMoney('abc', 'amount')).toThrow(/is not a valid number/);
      expect(() => parseMoney('', 'amount')).toThrow(BadRequestException);
    });

    it('names the offending field so the caller can fix the right input', () => {
      expect(() => parseMoney('-1', 'bonusAmountToApply')).toThrow(/bonusAmountToApply/);
    });
  });

  describe('accepts valid amounts without altering them', () => {
    it.each([
      ['0', '0'],
      ['0.0001', '0.0001'],
      ['1000', '1000'],
      ['99999999999999.9999', '99999999999999.9999'],
    ])('parses %s exactly', (input, expected) => {
      expect(parseMoney(input, 'amount').toString()).toBe(expected);
    });

    it('accepts exactly the maximum but not one unit more', () => {
      expect(() => parseMoney(MONEY_MAX, 'amount')).not.toThrow();
      expect(() => parseMoney(MONEY_MAX.plus('0.0001'), 'amount')).toThrow(/exceeds the maximum/);
    });

    it('accepts an already-parsed Decimal unchanged', () => {
      const value = new Decimal('123.4500');
      expect(parseMoney(value, 'amount').equals(value)).toBe(true);
    });
  });

  describe('zero handling', () => {
    it('allows zero by default — a payment may apply no bonus', () => {
      expect(parseMoney('0', 'amount').isZero()).toBe(true);
    });

    it('rejects zero where a movement is required', () => {
      // A zero accrual would write a ledger entry describing nothing,
      // and a zero reservation would hold nothing while looking like a hold.
      expect(() => parsePositiveMoney('0', 'accrual amount')).toThrow(/greater than zero/);
      expect(() => parsePositiveMoney('0.0000', 'accrual amount')).toThrow(/greater than zero/);
    });

    it('parsePositiveMoney still rejects everything parseMoney rejects', () => {
      expect(() => parsePositiveMoney('-1', 'amount')).toThrow(/must not be negative/);
      expect(() => parsePositiveMoney('NaN', 'amount')).toThrow(BadRequestException);
    });
  });
});

describe('decimal arithmetic', () => {
  it('does not lose precision the way binary floating point does', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754. Money cannot work that
    // way: this is why every amount is a Decimal end to end.
    expect(sumDecimals(['0.1', '0.2']).toString()).toBe('0.3');
    expect(toDecimal('0.1').plus('0.2').equals(new Decimal('0.3'))).toBe(true);
  });

  it('sums an empty list to zero rather than undefined', () => {
    expect(sumDecimals([]).toString()).toBe('0');
  });

  it('keeps large sums exact', () => {
    const values = Array.from({ length: 1000 }, () => '0.0001');
    expect(sumDecimals(values).toString()).toBe('0.1');
  });
});
