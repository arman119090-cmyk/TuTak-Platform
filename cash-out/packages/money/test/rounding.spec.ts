import { divideRounded, floorToIncrement, RoundingMode, ROUNDING_MODES } from '../src/rounding';

describe('divideRounded', () => {
  it('returns the exact quotient when there is no remainder', () => {
    for (const mode of ROUNDING_MODES) {
      expect(divideRounded(100n, 4n, mode)).toBe(25n);
      expect(divideRounded(-100n, 4n, mode)).toBe(-25n);
    }
  });

  it('rejects division by zero', () => {
    expect(() => divideRounded(1n, 0n, 'HALF_UP')).toThrow(RangeError);
  });

  const cases: ReadonlyArray<[bigint, bigint, RoundingMode, bigint]> = [
    [5n, 2n, 'TRUNCATE', 2n],
    [5n, 2n, 'AWAY_FROM_ZERO', 3n],
    [5n, 2n, 'FLOOR', 2n],
    [5n, 2n, 'CEIL', 3n],
    [5n, 2n, 'HALF_UP', 3n],
    [5n, 2n, 'HALF_DOWN', 2n],
    [5n, 2n, 'HALF_EVEN', 2n],
    [7n, 2n, 'HALF_EVEN', 4n],
    [-5n, 2n, 'TRUNCATE', -2n],
    [-5n, 2n, 'AWAY_FROM_ZERO', -3n],
    [-5n, 2n, 'FLOOR', -3n],
    [-5n, 2n, 'CEIL', -2n],
    [-5n, 2n, 'HALF_UP', -3n],
    [-5n, 2n, 'HALF_DOWN', -2n],
    [-5n, 2n, 'HALF_EVEN', -2n],
    [-7n, 2n, 'HALF_EVEN', -4n],
    [1n, 3n, 'HALF_UP', 0n],
    [2n, 3n, 'HALF_UP', 1n],
  ];

  it.each(cases)('divideRounded(%s, %s, %s) === %s', (n, d, mode, expected) => {
    expect(divideRounded(n, d, mode)).toBe(expected);
  });

  it('is sign-symmetric for the magnitude-based modes', () => {
    for (const mode of ['TRUNCATE', 'AWAY_FROM_ZERO', 'HALF_UP', 'HALF_DOWN', 'HALF_EVEN'] as const) {
      for (let n = -50n; n <= 50n; n += 1n) {
        expect(divideRounded(-n, 7n, mode)).toBe(-divideRounded(n, 7n, mode));
      }
    }
  });

  it('normalises a negative denominator', () => {
    expect(divideRounded(5n, -2n, 'HALF_UP')).toBe(-3n);
    expect(divideRounded(-5n, -2n, 'HALF_UP')).toBe(3n);
  });

  it('never rounds further than one unit away from the truncated quotient', () => {
    for (const mode of ROUNDING_MODES) {
      for (let n = -200n; n <= 200n; n += 1n) {
        const truncated = n / 7n;
        const rounded = divideRounded(n, 7n, mode);
        const delta = rounded - truncated;
        expect(delta === -1n || delta === 0n || delta === 1n).toBe(true);
      }
    }
  });

  it('handles values far beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const huge = 9_007_199_254_740_993n * 1_000_000_007n;
    expect(divideRounded(huge * 3n, 3n, 'HALF_UP')).toBe(huge);
  });
});

describe('floorToIncrement', () => {
  it('is the identity for increment 1', () => {
    expect(floorToIncrement(12345n, 1n)).toBe(12345n);
  });

  it('floors towards zero on both sides', () => {
    expect(floorToIncrement(12345n, 100n)).toBe(12300n);
    expect(floorToIncrement(-12345n, 100n)).toBe(-12300n);
    expect(floorToIncrement(12300n, 100n)).toBe(12300n);
  });

  it('rejects a non-positive increment', () => {
    expect(() => floorToIncrement(1n, 0n)).toThrow(RangeError);
    expect(() => floorToIncrement(1n, -5n)).toThrow(RangeError);
  });
});
