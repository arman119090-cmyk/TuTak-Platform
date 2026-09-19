import { CurrencyCode } from './currency';
import { Money } from './money';
import { RoundingMode } from './rounding';

/**
 * A single fee component (Cash Out's own commission, or the bank/PSP's).
 *
 * The rate is an exact rational `rateNumerator / rateDenominator` — basis points
 * are the conventional choice (`250 / 10_000` = 2.5%) but any denominator works
 * and nothing is ever converted to a float.
 */
export interface FeeComponentConfig {
  readonly rateNumerator: bigint;
  readonly rateDenominator: bigint;
  readonly fixedMinor: bigint;
  readonly minMinor?: bigint;
  readonly maxMinor?: bigint;
  readonly rounding: RoundingMode;
}

export class FeeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeConfigError';
  }
}

export class AmountTooSmallError extends Error {
  constructor(
    readonly gross: Money,
    readonly totalFee: Money,
  ) {
    super(`Requested amount ${gross.toString()} does not cover fees of ${totalFee.toString()}`);
    this.name = 'AmountTooSmallError';
  }
}

export function assertValidFeeConfig(config: FeeComponentConfig, label: string): void {
  if (config.rateDenominator <= 0n) {
    throw new FeeConfigError(`${label}: rateDenominator must be positive`);
  }
  if (config.rateNumerator < 0n) {
    throw new FeeConfigError(`${label}: rateNumerator must not be negative`);
  }
  if (config.fixedMinor < 0n) {
    throw new FeeConfigError(`${label}: fixedMinor must not be negative`);
  }
  if (config.minMinor !== undefined && config.minMinor < 0n) {
    throw new FeeConfigError(`${label}: minMinor must not be negative`);
  }
  if (config.maxMinor !== undefined && config.maxMinor < 0n) {
    throw new FeeConfigError(`${label}: maxMinor must not be negative`);
  }
  if (
    config.minMinor !== undefined &&
    config.maxMinor !== undefined &&
    config.minMinor > config.maxMinor
  ) {
    throw new FeeConfigError(`${label}: minMinor must not exceed maxMinor`);
  }
}

/**
 * Evaluates one fee component against a gross amount.
 *
 * `fee = clamp(round(gross * rate) + fixed, min, max)`, evaluated on the
 * magnitude of `gross` so that the fee is never negative.
 */
export function evaluateFee(gross: Money, config: FeeComponentConfig, label = 'fee'): Money {
  assertValidFeeConfig(config, label);
  const base = gross.abs();
  const proportional = base.multiplyRatio(
    config.rateNumerator,
    config.rateDenominator,
    config.rounding,
  );
  let feeMinor = proportional.minor + config.fixedMinor;
  if (config.minMinor !== undefined && feeMinor < config.minMinor) {
    feeMinor = config.minMinor;
  }
  if (config.maxMinor !== undefined && feeMinor > config.maxMinor) {
    feeMinor = config.maxMinor;
  }
  return Money.fromMinor(feeMinor, gross.currency);
}

export interface FeeSchedule {
  /** Cash Out's own commission, charged to the driver. */
  readonly platform: FeeComponentConfig;
  /** What the bank / PSP charges for moving the money. */
  readonly provider: FeeComponentConfig;
  /**
   * Smallest number of minor units the payout rail can actually move. Any
   * remainder below this granularity is left on the driver's Yandex balance
   * rather than being debited, so nothing is ever rounded into thin air.
   */
  readonly payoutIncrementMinor?: bigint;
}

/**
 * The numbers the driver is shown before confirming, and the numbers the ledger
 * is later written from. They are the same numbers — a quote is persisted with
 * the withdrawal and never recomputed at confirmation time.
 */
export interface WithdrawalQuote {
  readonly currency: CurrencyCode;
  /** Debited from the driver's Yandex balance. */
  readonly gross: Money;
  readonly platformFee: Money;
  readonly providerFee: Money;
  readonly totalFee: Money;
  /** What actually lands on the driver's card/account. */
  readonly net: Money;
  /**
   * Set when `payoutIncrementMinor` forced the payout down to a movable amount:
   * the difference between what the driver asked for and `gross`.
   */
  readonly unusedRemainder: Money;
}

/**
 * Builds a quote from a requested gross amount (the amount debited from the
 * driver's Yandex balance).
 *
 * Invariant, asserted before returning: `gross === net + platformFee + providerFee`.
 */
export function quoteFromGross(requested: Money, schedule: FeeSchedule): WithdrawalQuote {
  if (!requested.isPositive) {
    throw new RangeError('quoteFromGross: requested amount must be positive');
  }

  const platformFee = evaluateFee(requested, schedule.platform, 'platform fee');
  const providerFee = evaluateFee(requested, schedule.provider, 'provider fee');
  const totalFee = platformFee.add(providerFee);
  const rawNet = requested.subtract(totalFee);

  if (!rawNet.isPositive) {
    throw new AmountTooSmallError(requested, totalFee);
  }

  const increment = schedule.payoutIncrementMinor ?? 1n;
  const net = increment > 1n ? rawNet.floorToIncrement(increment) : rawNet;
  if (!net.isPositive) {
    throw new AmountTooSmallError(requested, totalFee);
  }
  const gross = net.add(totalFee);
  const unusedRemainder = requested.subtract(gross);

  assertQuoteConsistent({
    currency: requested.currency,
    gross,
    platformFee,
    providerFee,
    totalFee,
    net,
    unusedRemainder,
  });

  return {
    currency: requested.currency,
    gross,
    platformFee,
    providerFee,
    totalFee,
    net,
    unusedRemainder,
  };
}

/**
 * Builds a quote from a desired net amount — "put exactly 10 000 on my card".
 *
 * Fees are not necessarily linear (fixed parts, floors and caps), so rather than
 * inverting the formula algebraically this binary-searches the smallest gross
 * whose quote yields at least `desiredNet`. `netForGross` is non-decreasing in
 * gross for any valid schedule, which is what makes the search sound.
 */
export function quoteForNet(
  desiredNet: Money,
  schedule: FeeSchedule,
  maxGross: Money,
): WithdrawalQuote | null {
  if (!desiredNet.isPositive) {
    throw new RangeError('quoteForNet: desired net must be positive');
  }
  if (desiredNet.currency !== maxGross.currency) {
    throw new RangeError('quoteForNet: currency mismatch between desired net and max gross');
  }

  const netFor = (grossMinor: bigint): bigint | null => {
    try {
      return quoteFromGross(Money.fromMinor(grossMinor, desiredNet.currency), schedule).net.minor;
    } catch (error) {
      if (error instanceof AmountTooSmallError) return null;
      throw error;
    }
  };

  let low = 1n;
  let high = maxGross.minor;
  if (high < low) return null;
  const bestNet = netFor(high);
  if (bestNet === null || bestNet < desiredNet.minor) {
    return null;
  }

  while (low < high) {
    const mid = low + (high - low) / 2n;
    const midNet = netFor(mid);
    if (midNet !== null && midNet >= desiredNet.minor) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  return quoteFromGross(Money.fromMinor(low, desiredNet.currency), schedule);
}

export class QuoteConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteConsistencyError';
  }
}

/**
 * The guard that makes "no money is lost" a runtime property rather than a
 * comment: every quote is checked against its own accounting identity before it
 * leaves this module, and again before it is written to the ledger.
 */
export function assertQuoteConsistent(quote: WithdrawalQuote): void {
  const recomposed = quote.net.add(quote.platformFee).add(quote.providerFee);
  if (!recomposed.equals(quote.gross)) {
    throw new QuoteConsistencyError(
      `Quote does not balance: net ${quote.net.toString()} + platform ${quote.platformFee.toString()} ` +
        `+ provider ${quote.providerFee.toString()} = ${recomposed.toString()}, expected gross ${quote.gross.toString()}`,
    );
  }
  if (!quote.totalFee.equals(quote.platformFee.add(quote.providerFee))) {
    throw new QuoteConsistencyError('Quote totalFee does not equal the sum of its components');
  }
  if (quote.net.isNegative || quote.platformFee.isNegative || quote.providerFee.isNegative) {
    throw new QuoteConsistencyError('Quote contains a negative component');
  }
  if (quote.unusedRemainder.isNegative) {
    throw new QuoteConsistencyError('Quote unusedRemainder is negative');
  }
}
