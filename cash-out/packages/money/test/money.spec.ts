import { CurrencyMismatchError, Money, MoneyParseError } from '../src/money';

describe('Money construction', () => {
  it('builds from minor units', () => {
    expect(Money.fromMinor(123456n, 'AMD').toDecimalString()).toBe('1234.56');
    expect(Money.fromMinor('123456', 'AMD').minor).toBe(123456n);
    expect(Money.fromMinor(-1n, 'AMD').toDecimalString()).toBe('-0.01');
    expect(Money.zero('AMD').toDecimalString()).toBe('0.00');
  });

  it('refuses unsafe numbers and non-integer strings', () => {
    expect(() => Money.fromMinor(1.5, 'AMD')).toThrow(MoneyParseError);
    expect(() => Money.fromMinor(Number.MAX_SAFE_INTEGER + 2, 'AMD')).toThrow(MoneyParseError);
    expect(() => Money.fromMinor('12.34', 'AMD')).toThrow(MoneyParseError);
  });

  it('refuses an unknown currency', () => {
    expect(() => Money.fromMinor(1n, 'XYZ' as never)).toThrow(MoneyParseError);
  });

  it('parses decimal strings exactly', () => {
    expect(Money.fromDecimalString('1234.56', 'AMD').minor).toBe(123456n);
    expect(Money.fromDecimalString('1234.5', 'AMD').minor).toBe(123450n);
    expect(Money.fromDecimalString('1234', 'AMD').minor).toBe(123400n);
    expect(Money.fromDecimalString('-0.01', 'AMD').minor).toBe(-1n);
    expect(Money.fromDecimalString('  42.00  ', 'AMD').minor).toBe(4200n);
    expect(Money.fromDecimalString('+7.25', 'AMD').minor).toBe(725n);
  });

  it('rejects garbage rather than guessing', () => {
    for (const bad of ['', 'abc', '1,23', '1.2.3', '1e5', '--1', '.5', '1.']) {
      expect(() => Money.fromDecimalString(bad, 'AMD')).toThrow(MoneyParseError);
    }
  });

  it('refuses excess precision unless a rounding mode is given', () => {
    expect(() => Money.fromDecimalString('1234.5678', 'AMD')).toThrow(MoneyParseError);
    expect(Money.fromDecimalString('1234.5678', 'AMD', 'HALF_UP').minor).toBe(123457n);
    expect(Money.fromDecimalString('1234.5678', 'AMD', 'TRUNCATE').minor).toBe(123456n);
    expect(Money.fromDecimalString('1234.5650', 'AMD', 'HALF_EVEN').minor).toBe(123456n);
    expect(Money.fromDecimalString('-1234.5678', 'AMD', 'HALF_UP').minor).toBe(-123457n);
    expect(Money.fromDecimalString('-1234.5678', 'AMD', 'FLOOR').minor).toBe(-123457n);
  });

  it('round-trips through its canonical decimal string', () => {
    for (const minor of [0n, 1n, -1n, 99n, 100n, 123456789n, -987654321n]) {
      const money = Money.fromMinor(minor, 'AMD');
      expect(Money.fromDecimalString(money.toDecimalString(), 'AMD').minor).toBe(minor);
    }
  });

  it('round-trips through JSON without ever producing a JSON number', () => {
    const money = Money.fromMinor(9_007_199_254_740_993n, 'AMD');
    const json = JSON.parse(JSON.stringify(money)) as { minor: string; currency: string };
    expect(typeof json.minor).toBe('string');
    expect(Money.fromJSON(json as never).equals(money)).toBe(true);
  });
});

describe('Money arithmetic', () => {
  const amd = (minor: bigint) => Money.fromMinor(minor, 'AMD');

  it('adds and subtracts exactly', () => {
    expect(amd(100n).add(amd(250n)).minor).toBe(350n);
    expect(amd(100n).subtract(amd(250n)).minor).toBe(-150n);
  });

  it('refuses to mix currencies', () => {
    expect(() => amd(100n).add(Money.fromMinor(100n, 'RUB'))).toThrow(CurrencyMismatchError);
    expect(() => amd(100n).compare(Money.fromMinor(100n, 'RUB'))).toThrow(CurrencyMismatchError);
    expect(amd(100n).equals(Money.fromMinor(100n, 'RUB'))).toBe(false);
  });

  it('multiplies by a rational with an explicit rounding mode', () => {
    expect(amd(100_00n).multiplyRatio(250n, 10_000n, 'HALF_UP').minor).toBe(250n);
    expect(amd(333n).multiplyRatio(1n, 3n, 'TRUNCATE').minor).toBe(111n);
    expect(amd(100n).multiplyRatio(1n, 3n, 'HALF_UP').minor).toBe(33n);
    expect(amd(100n).multiplyRatio(1n, 3n, 'CEIL').minor).toBe(34n);
  });

  it('compares and orders', () => {
    expect(amd(1n).lessThan(amd(2n))).toBe(true);
    expect(amd(2n).greaterThan(amd(1n))).toBe(true);
    expect(amd(2n).greaterThanOrEqual(amd(2n))).toBe(true);
    expect(Money.min(amd(1n), amd(2n)).minor).toBe(1n);
    expect(Money.max(amd(1n), amd(2n)).minor).toBe(2n);
    expect(Money.sum([amd(1n), amd(2n), amd(3n)], 'AMD').minor).toBe(6n);
    expect(Money.sum([], 'AMD').minor).toBe(0n);
  });

  it('exposes sign predicates', () => {
    expect(amd(0n).isZero).toBe(true);
    expect(amd(-1n).isNegative).toBe(true);
    expect(amd(1n).isPositive).toBe(true);
    expect(amd(-5n).abs().minor).toBe(5n);
    expect(amd(5n).negated().minor).toBe(-5n);
  });
});

describe('Money.allocate', () => {
  const amd = (minor: bigint) => Money.fromMinor(minor, 'AMD');

  it('never loses or invents a minor unit', () => {
    for (const total of [1n, 2n, 7n, 100n, 101n, 999_999n]) {
      for (const weights of [[1n, 1n], [1n, 2n], [1n, 1n, 1n], [70n, 20n, 10n], [1n, 0n]]) {
        const parts = amd(total).allocate(weights);
        expect(parts).toHaveLength(weights.length);
        const sum = parts.reduce((acc, part) => acc + part.minor, 0n);
        expect(sum).toBe(total);
      }
    }
  });

  it('preserves the sign of a negative amount', () => {
    const parts = amd(-7n).allocate([1n, 1n, 1n]);
    expect(parts.reduce((acc, p) => acc + p.minor, 0n)).toBe(-7n);
    expect(parts.every((p) => p.minor <= 0n)).toBe(true);
  });

  it('rejects degenerate weights', () => {
    expect(() => amd(10n).allocate([])).toThrow(RangeError);
    expect(() => amd(10n).allocate([0n, 0n])).toThrow(RangeError);
    expect(() => amd(10n).allocate([-1n, 2n])).toThrow(RangeError);
  });
});

describe('Money.floorToIncrement', () => {
  it('drops the sub-increment remainder', () => {
    expect(Money.fromMinor(12345n, 'AMD').floorToIncrement(100n).minor).toBe(12300n);
  });
});
