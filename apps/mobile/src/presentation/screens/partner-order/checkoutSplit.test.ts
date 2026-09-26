import { computeCheckoutSplit, parseCheckoutAmount } from '@tutak/shared-types';

/**
 * The checkout split the mobile app and TuTak Web Checkout both render —
 * Q13: only TuTak money counts toward the minimum prepayment.
 */
describe('computeCheckoutSplit', () => {
  const base = { total: 100_000, discountAvailable: 20_000, maxDiscountAmount: 100_000, moneyBalance: 0, prepaymentRequired: 20_000 };

  it('20 000 green with 0 TuTak money does NOT satisfy a 20 000 prepayment', () => {
    const split = computeCheckoutSplit({ ...base, discountInput: 20_000, moneyInput: 0 });
    expect(split.discount).toBe(20_000);
    expect(split.prepaymentShort).toBe(20_000);
    expect(split.canConfirm).toBe(false);
  });

  it('the prepayment is covered by TuTak money only — the discount still lowers the price', () => {
    const split = computeCheckoutSplit({ ...base, moneyBalance: 20_000, discountInput: 20_000, moneyInput: 20_000 });
    expect(split).toEqual({ discount: 20_000, money: 20_000, external: 60_000, missingMoney: 0, prepaymentShort: 0, canConfirm: true });
  });

  it('asks for a top-up of exactly the missing money', () => {
    const split = computeCheckoutSplit({ ...base, moneyBalance: 5_000, discountInput: 0, moneyInput: 20_000 });
    expect(split.missingMoney).toBe(15_000);
    expect(split.canConfirm).toBe(false);
  });

  it('caps the discount by the partner limit and the balance, and money by what is left', () => {
    const split = computeCheckoutSplit({ ...base, prepaymentRequired: 0, maxDiscountAmount: 10_000, moneyBalance: 200_000, discountInput: 50_000, moneyInput: 500_000 });
    expect(split.discount).toBe(10_000);
    expect(split.money).toBe(90_000);
    expect(split.external).toBe(0);
  });

  it('parses whole AMD only', () => {
    expect(parseCheckoutAmount('20 000')).toBe(20_000);
    expect(parseCheckoutAmount('12.9')).toBe(12);
    expect(parseCheckoutAmount('-5')).toBe(0);
    expect(parseCheckoutAmount('abc')).toBe(0);
  });
});
