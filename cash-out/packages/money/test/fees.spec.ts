import {
  AmountTooSmallError,
  assertQuoteConsistent,
  evaluateFee,
  FeeComponentConfig,
  FeeConfigError,
  FeeSchedule,
  quoteForNet,
  quoteFromGross,
} from '../src/fees';
import { Money } from '../src/money';

const amd = (minor: bigint) => Money.fromMinor(minor, 'AMD');

const percent = (bps: bigint, fixedMinor = 0n): FeeComponentConfig => ({
  rateNumerator: bps,
  rateDenominator: 10_000n,
  fixedMinor,
  rounding: 'HALF_UP',
});

/** 2% + 50.00 platform fee, 0.6% + 10.00 provider fee. */
const schedule: FeeSchedule = {
  platform: percent(200n, 5_000n),
  provider: percent(60n, 1_000n),
};

describe('evaluateFee', () => {
  it('applies rate plus fixed part', () => {
    expect(evaluateFee(amd(100_000n), percent(200n, 5_000n)).minor).toBe(7_000n);
  });

  it('applies a floor and a cap', () => {
    const capped: FeeComponentConfig = { ...percent(200n), minMinor: 3_000n, maxMinor: 10_000n };
    expect(evaluateFee(amd(1_000n), capped).minor).toBe(3_000n);
    expect(evaluateFee(amd(100_000n), capped).minor).toBe(3_000n);
    expect(evaluateFee(amd(10_000_000n), capped).minor).toBe(10_000n);
  });

  it('is computed on the magnitude, so it is never negative', () => {
    expect(evaluateFee(amd(-100_000n), percent(200n)).minor).toBe(2_000n);
  });

  it('rejects an invalid configuration instead of producing a wrong number', () => {
    expect(() => evaluateFee(amd(100n), { ...percent(200n), rateDenominator: 0n })).toThrow(
      FeeConfigError,
    );
    expect(() => evaluateFee(amd(100n), { ...percent(200n), rateNumerator: -1n })).toThrow(
      FeeConfigError,
    );
    expect(() => evaluateFee(amd(100n), { ...percent(200n), fixedMinor: -1n })).toThrow(
      FeeConfigError,
    );
    expect(() =>
      evaluateFee(amd(100n), { ...percent(200n), minMinor: 500n, maxMinor: 100n }),
    ).toThrow(FeeConfigError);
  });

  it('respects the rounding mode on the proportional part', () => {
    const third: FeeComponentConfig = {
      rateNumerator: 1n,
      rateDenominator: 3n,
      fixedMinor: 0n,
      rounding: 'TRUNCATE',
    };
    expect(evaluateFee(amd(100n), third).minor).toBe(33n);
    expect(evaluateFee(amd(100n), { ...third, rounding: 'CEIL' }).minor).toBe(34n);
    expect(evaluateFee(amd(100n), { ...third, rounding: 'HALF_UP' }).minor).toBe(33n);
  });
});

describe('quoteFromGross', () => {
  it('produces the numbers shown on the review screen', () => {
    const quote = quoteFromGross(amd(100_000n), schedule);
    expect(quote.platformFee.minor).toBe(7_000n);
    expect(quote.providerFee.minor).toBe(1_600n);
    expect(quote.totalFee.minor).toBe(8_600n);
    expect(quote.net.minor).toBe(91_400n);
    expect(quote.gross.minor).toBe(100_000n);
    expect(quote.unusedRemainder.isZero).toBe(true);
  });

  it('balances for every amount in a wide sweep', () => {
    for (let gross = 10_000n; gross <= 5_000_000n; gross += 997n) {
      const quote = quoteFromGross(amd(gross), schedule);
      expect(quote.net.add(quote.totalFee).add(quote.unusedRemainder).minor).toBe(gross);
      expect(() => assertQuoteConsistent(quote)).not.toThrow();
    }
  });

  it('refuses an amount that does not cover the fees', () => {
    expect(() => quoteFromGross(amd(6_000n), schedule)).toThrow(AmountTooSmallError);
    expect(() => quoteFromGross(amd(0n), schedule)).toThrow(RangeError);
    expect(() => quoteFromGross(amd(-100n), schedule)).toThrow(RangeError);
  });

  it('leaves the sub-increment remainder on the balance instead of losing it', () => {
    const wholeUnitsOnly: FeeSchedule = { ...schedule, payoutIncrementMinor: 100n };
    const quote = quoteFromGross(amd(100_000n), wholeUnitsOnly);
    expect(quote.net.minor % 100n).toBe(0n);
    expect(quote.net.minor).toBe(91_400n);
    const odd = quoteFromGross(amd(100_037n), wholeUnitsOnly);
    expect(odd.net.minor % 100n).toBe(0n);
    expect(odd.net.add(odd.totalFee).add(odd.unusedRemainder).minor).toBe(100_037n);
    expect(odd.unusedRemainder.isPositive).toBe(true);
    expect(odd.gross.lessThan(amd(100_037n))).toBe(true);
  });

  it('never returns a gross larger than what the driver asked for', () => {
    const wholeUnitsOnly: FeeSchedule = { ...schedule, payoutIncrementMinor: 100n };
    for (let gross = 20_000n; gross <= 400_000n; gross += 331n) {
      const quote = quoteFromGross(amd(gross), wholeUnitsOnly);
      expect(quote.gross.minor).toBeLessThanOrEqual(gross);
      expect(quote.unusedRemainder.minor).toBe(gross - quote.gross.minor);
    }
  });

  it('is monotonic: asking for more never yields less', () => {
    let previousNet = -1n;
    for (let gross = 10_000n; gross <= 1_000_000n; gross += 613n) {
      const net = quoteFromGross(amd(gross), schedule).net.minor;
      expect(net).toBeGreaterThanOrEqual(previousNet);
      previousNet = net;
    }
  });
});

describe('quoteForNet', () => {
  it('finds the smallest gross that delivers the requested net', () => {
    const quote = quoteForNet(amd(91_400n), schedule, amd(10_000_000n));
    expect(quote).not.toBeNull();
    expect(quote!.net.minor).toBeGreaterThanOrEqual(91_400n);
    const oneLess = quoteFromGross(amd(quote!.gross.minor - 1n), schedule);
    expect(oneLess.net.minor).toBeLessThan(91_400n);
  });

  it('returns null when the ceiling cannot deliver the requested net', () => {
    expect(quoteForNet(amd(1_000_000n), schedule, amd(100_000n))).toBeNull();
    expect(quoteForNet(amd(100n), schedule, amd(1n))).toBeNull();
  });

  it('rejects nonsense input', () => {
    expect(() => quoteForNet(amd(0n), schedule, amd(100n))).toThrow(RangeError);
    expect(() => quoteForNet(amd(10n), schedule, Money.fromMinor(10n, 'RUB'))).toThrow(RangeError);
  });
});

describe('assertQuoteConsistent', () => {
  it('catches a tampered quote', () => {
    const quote = quoteFromGross(amd(100_000n), schedule);
    expect(() => assertQuoteConsistent({ ...quote, net: amd(91_401n) })).toThrow(
      /does not balance/,
    );
    expect(() => assertQuoteConsistent({ ...quote, totalFee: amd(1n) })).toThrow(/totalFee/);
    expect(() =>
      assertQuoteConsistent({
        ...quote,
        platformFee: amd(-1n),
        providerFee: amd(1_600n),
        totalFee: amd(1_599n),
        net: amd(98_401n),
      }),
    ).toThrow(/negative component/);
    expect(() => assertQuoteConsistent({ ...quote, unusedRemainder: amd(-1n) })).toThrow(
      /unusedRemainder/,
    );
  });
});
