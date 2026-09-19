/**
 * Rounding primitives for exact integer (minor-unit) arithmetic.
 *
 * Every monetary computation in Cash Out goes through `divideRounded`. There is
 * no floating point anywhere in this package: inputs are `bigint`, outputs are
 * `bigint`, and the rounding decision is always explicit at the call site.
 */

export const ROUNDING_MODES = [
  /** Truncate towards zero (drop the remainder). */
  'TRUNCATE',
  /** Always round away from zero when there is any remainder. */
  'AWAY_FROM_ZERO',
  /** Round towards negative infinity. */
  'FLOOR',
  /** Round towards positive infinity. */
  'CEIL',
  /** Round half away from zero (the "commercial" rounding most people expect). */
  'HALF_UP',
  /** Round half towards zero. */
  'HALF_DOWN',
  /** Round half to even (banker's rounding) — unbiased over many operations. */
  'HALF_EVEN',
] as const;

export type RoundingMode = (typeof ROUNDING_MODES)[number];

/**
 * Divides `numerator` by `denominator` and rounds the exact rational result to
 * an integer using `mode`.
 *
 * The sign of the result follows the sign of the exact quotient; the rounding
 * mode is applied to the magnitude relationship described by its own name
 * (so `FLOOR`/`CEIL` are direction-sensitive, `HALF_UP` is magnitude-sensitive).
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new RangeError('divideRounded: division by zero');
  }

  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }

  const truncated = n / d;
  const remainder = n - truncated * d;
  if (remainder === 0n) {
    return truncated;
  }

  const isNegative = remainder < 0n;
  const absRemainderDoubled = (isNegative ? -remainder : remainder) * 2n;
  const awayFromZero = isNegative ? truncated - 1n : truncated + 1n;

  switch (mode) {
    case 'TRUNCATE':
      return truncated;
    case 'AWAY_FROM_ZERO':
      return awayFromZero;
    case 'FLOOR':
      return isNegative ? truncated - 1n : truncated;
    case 'CEIL':
      return isNegative ? truncated : truncated + 1n;
    case 'HALF_UP':
      return absRemainderDoubled >= d ? awayFromZero : truncated;
    case 'HALF_DOWN':
      return absRemainderDoubled > d ? awayFromZero : truncated;
    case 'HALF_EVEN':
      if (absRemainderDoubled > d) return awayFromZero;
      if (absRemainderDoubled < d) return truncated;
      return truncated % 2n === 0n ? truncated : awayFromZero;
    default: {
      const exhaustive: never = mode;
      throw new RangeError(`divideRounded: unknown rounding mode ${String(exhaustive)}`);
    }
  }
}

/**
 * Rounds `value` down to the nearest multiple of `increment` (towards zero for
 * positive values, towards zero for negative values as well).
 *
 * Used where a payment rail cannot move arbitrary minor units — e.g. a bank that
 * only accepts whole currency units.
 */
export function floorToIncrement(value: bigint, increment: bigint): bigint {
  if (increment <= 0n) {
    throw new RangeError('floorToIncrement: increment must be positive');
  }
  if (increment === 1n) return value;
  const remainder = value % increment;
  return remainder === 0n ? value : value - remainder;
}
