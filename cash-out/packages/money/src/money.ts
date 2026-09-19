import { CurrencyCode, getCurrency, isCurrencyCode, minorUnitScale } from './currency';
import { divideRounded, floorToIncrement, RoundingMode } from './rounding';

const DECIMAL_PATTERN = /^[+-]?(\d+)(?:\.(\d+))?$/;

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: CurrencyCode,
    readonly right: CurrencyCode,
  ) {
    super(`Currency mismatch: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

export interface MoneyJSON {
  /** Integer minor units, serialised as a string so no JSON number ever sees it. */
  readonly minor: string;
  readonly currency: CurrencyCode;
}

/**
 * An exact monetary amount: integer minor units plus a currency.
 *
 * Money is immutable. Every operation returns a new instance, mixed-currency
 * arithmetic throws, and there is no implicit rounding anywhere — an operation
 * that cannot be exact demands a `RoundingMode` argument.
 */
export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: CurrencyCode,
  ) {}

  // ---------------------------------------------------------------- factories

  static fromMinor(minor: bigint | number | string, currency: CurrencyCode): Money {
    if (!isCurrencyCode(currency)) {
      throw new MoneyParseError(`Money.fromMinor: unsupported currency ${String(currency)}`);
    }
    let value: bigint;
    if (typeof minor === 'bigint') {
      value = minor;
    } else if (typeof minor === 'number') {
      if (!Number.isSafeInteger(minor)) {
        throw new MoneyParseError(
          `Money.fromMinor: ${minor} is not a safe integer; pass a bigint or a string`,
        );
      }
      value = BigInt(minor);
    } else {
      if (!/^[+-]?\d+$/.test(minor)) {
        throw new MoneyParseError(`Money.fromMinor: "${minor}" is not an integer string`);
      }
      value = BigInt(minor);
    }
    return new Money(value, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.fromMinor(0n, currency);
  }

  /**
   * Parses a decimal string ("1234.56").
   *
   * Strict by default: a value with more fractional digits than the currency
   * allows is rejected rather than silently rounded, because silently rounding
   * an amount that came from an external system is how money goes missing. Pass
   * a `RoundingMode` explicitly to accept extra precision — Yandex, for one,
   * reports park balances with four decimal places.
   */
  static fromDecimalString(
    value: string,
    currency: CurrencyCode,
    excessPrecision?: RoundingMode,
  ): Money {
    if (typeof value !== 'string') {
      throw new MoneyParseError('Money.fromDecimalString: value must be a string');
    }
    const trimmed = value.trim();
    const match = DECIMAL_PATTERN.exec(trimmed);
    if (!match) {
      throw new MoneyParseError(`Money.fromDecimalString: "${value}" is not a decimal number`);
    }
    const negative = trimmed.startsWith('-');
    const integerPart = match[1] ?? '0';
    const fractionPart = match[2] ?? '';
    const exponent = getCurrency(currency).exponent;

    let minorDigits: string;
    if (fractionPart.length <= exponent) {
      minorDigits = fractionPart.padEnd(exponent, '0');
    } else {
      if (!excessPrecision) {
        throw new MoneyParseError(
          `Money.fromDecimalString: "${value}" has ${fractionPart.length} fractional digits, ` +
            `${currency} allows ${exponent}; pass an explicit rounding mode to accept it`,
        );
      }
      const keep = fractionPart.slice(0, exponent);
      const drop = fractionPart.slice(exponent);
      const scaled = BigInt(integerPart + keep + drop);
      const divisor = 10n ** BigInt(drop.length);
      const rounded = divideRounded(negative ? -scaled : scaled, divisor, excessPrecision);
      return new Money(rounded, currency);
    }

    const magnitude = BigInt(integerPart + minorDigits);
    return new Money(negative ? -magnitude : magnitude, currency);
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.fromMinor(json.minor, json.currency);
  }

  // ----------------------------------------------------------------- guards

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  // -------------------------------------------------------------- arithmetic

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negated(): Money {
    return new Money(-this.minor, this.currency);
  }

  abs(): Money {
    return this.minor < 0n ? this.negated() : this;
  }

  /** Multiplies by an exact integer factor. Never rounds. */
  multiplyInteger(factor: bigint | number): Money {
    const value = typeof factor === 'bigint' ? factor : BigInt(factor);
    return new Money(this.minor * value, this.currency);
  }

  /**
   * Multiplies by the exact rational `numerator / denominator`, rounding the
   * result to whole minor units with `mode`.
   */
  multiplyRatio(numerator: bigint, denominator: bigint, mode: RoundingMode): Money {
    return new Money(divideRounded(this.minor * numerator, denominator, mode), this.currency);
  }

  /** Rounds down to the payment rail's smallest movable increment. */
  floorToIncrement(increment: bigint): Money {
    return new Money(floorToIncrement(this.minor, increment), this.currency);
  }

  /**
   * Splits the amount into `weights.length` parts proportional to `weights`,
   * distributing the unavoidable remainder one minor unit at a time so that the
   * parts always sum back to exactly the original amount.
   */
  allocate(weights: readonly bigint[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError('Money.allocate: weights must not be empty');
    }
    if (weights.some((w) => w < 0n)) {
      throw new RangeError('Money.allocate: weights must not be negative');
    }
    const total = weights.reduce((sum, w) => sum + w, 0n);
    if (total === 0n) {
      throw new RangeError('Money.allocate: weights must not all be zero');
    }

    const sign = this.minor < 0n ? -1n : 1n;
    const magnitude = this.minor * sign;
    const parts: bigint[] = [];
    let distributed = 0n;
    for (const weight of weights) {
      const share = (magnitude * weight) / total;
      parts.push(share);
      distributed += share;
    }
    let remainder = magnitude - distributed;
    for (let i = 0; remainder > 0n; i = (i + 1) % parts.length) {
      parts[i] = (parts[i] ?? 0n) + 1n;
      remainder -= 1n;
    }
    return parts.map((part) => new Money(part * sign, this.currency));
  }

  // -------------------------------------------------------------- comparison

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  get isZero(): boolean {
    return this.minor === 0n;
  }

  get isNegative(): boolean {
    return this.minor < 0n;
  }

  get isPositive(): boolean {
    return this.minor > 0n;
  }

  static min(a: Money, b: Money): Money {
    return a.lessThanOrEqual(b) ? a : b;
  }

  static max(a: Money, b: Money): Money {
    return a.greaterThanOrEqual(b) ? a : b;
  }

  static sum(amounts: readonly Money[], currency: CurrencyCode): Money {
    return amounts.reduce((acc, amount) => acc.add(amount), Money.zero(currency));
  }

  // ------------------------------------------------------------ serialisation

  /** Canonical decimal representation, e.g. "-1234.56". */
  toDecimalString(): string {
    const exponent = getCurrency(this.currency).exponent;
    const negative = this.minor < 0n;
    const magnitude = (negative ? -this.minor : this.minor).toString();
    if (exponent === 0) {
      return (negative ? '-' : '') + magnitude;
    }
    const padded = magnitude.padStart(exponent + 1, '0');
    const integerPart = padded.slice(0, padded.length - exponent);
    const fractionPart = padded.slice(padded.length - exponent);
    return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
  }

  toJSON(): MoneyJSON {
    return { minor: this.minor.toString(), currency: this.currency };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  /** The scale factor for this amount's currency (10 ** exponent). */
  get scale(): bigint {
    return minorUnitScale(this.currency);
  }
}
