import { Decimal } from '@prisma/client/runtime/library';
import { splitRefundAcrossComponents } from './purchase-intent-refund.service';

/**
 * Audit of 21.09.2026, finding D09: the refund split across the three
 * funding components must never manufacture an external (cash) slice where
 * there was none, and must never go negative.
 *
 * Properties, over every step of every partial-refund sequence:
 *
 *  - every component delta ≥ 0;
 *  - the three deltas sum exactly to the refund amount (conservation);
 *  - the cumulative of each component never exceeds its original;
 *  - after a full refund each cumulative equals its original exactly;
 *  - a purchase with no external money has an external slice of 0 at
 *    *every* step, not only at the end.
 */
describe('splitRefundAcrossComponents (audit D09)', () => {
  const D = (v: string | number) => new Decimal(v);

  function walk(
    gross: string,
    bonus: string,
    prepaid: string,
    refunds: string[],
  ): { bonus: Decimal; prepaid: Decimal; external: Decimal }[] {
    const out: { bonus: Decimal; prepaid: Decimal; external: Decimal }[] = [];
    let cumulative = D(0);
    for (const amount of refunds) {
      const after = cumulative.plus(amount);
      out.push(
        splitRefundAcrossComponents({
          amount: D(amount),
          grossAmount: D(gross),
          bonusAmountRequested: D(bonus),
          prepaidAmountApplied: D(prepaid),
          cumulativeBefore: cumulative,
          cumulativeAfter: after,
        }),
      );
      cumulative = after;
    }
    return out;
  }

  function assertProperties(gross: string, bonus: string, prepaid: string, refunds: string[]) {
    const external = D(gross).minus(bonus).minus(prepaid);
    const steps = walk(gross, bonus, prepaid, refunds);
    let cb = D(0);
    let cp = D(0);
    let ce = D(0);
    steps.forEach((step, i) => {
      const label = `G=${gross} B=${bonus} P=${prepaid} step ${i + 1} (${refunds[i]})`;
      expect(step.bonus.greaterThanOrEqualTo(0)).toBe(true);
      expect(step.prepaid.greaterThanOrEqualTo(0)).toBe(true);
      expect({ label, external: step.external.toString(), nonNegative: step.external.greaterThanOrEqualTo(0) }).toEqual({
        label,
        external: step.external.toString(),
        nonNegative: true,
      });
      expect(step.bonus.plus(step.prepaid).plus(step.external).toFixed(4)).toBe(D(refunds[i]!).toFixed(4));
      cb = cb.plus(step.bonus);
      cp = cp.plus(step.prepaid);
      ce = ce.plus(step.external);
      expect(cb.lessThanOrEqualTo(bonus)).toBe(true);
      expect(cp.lessThanOrEqualTo(prepaid)).toBe(true);
      expect(ce.lessThanOrEqualTo(external)).toBe(true);
      if (external.isZero()) expect(step.external.isZero()).toBe(true);
    });
    const total = refunds.reduce((s, r) => s.plus(r), D(0));
    if (total.equals(gross)) {
      expect(cb.toFixed(4)).toBe(D(bonus).toFixed(4));
      expect(cp.toFixed(4)).toBe(D(prepaid).toFixed(4));
      expect(ce.toFixed(4)).toBe(external.toFixed(4));
    }
  }

  it("the auditor's counter-example: gross 3, bonus 1, prepaid 2, refunds 1+1+1 — external is 0 every time", () => {
    const steps = walk('3', '1', '2', ['1', '1', '1']);
    expect(steps.map((s) => s.external.toString())).toEqual(['0', '0', '0']);
    expect(steps.map((s) => s.bonus.plus(s.prepaid).toString())).toEqual(['1', '1', '1']);
    assertProperties('3', '1', '2', ['1', '1', '1']);
  });

  it('a bonus-only purchase (G = B) refunds only bonus at every step', () => {
    assertProperties('7', '7', '0', ['1', '2', '4']);
    const steps = walk('7', '7', '0', ['3', '4']);
    expect(steps.map((s) => s.bonus.toString())).toEqual(['3', '4']);
    expect(steps.every((s) => s.prepaid.isZero() && s.external.isZero())).toBe(true);
  });

  it('a prepaid-only purchase refunds only prepaid at every step', () => {
    assertProperties('301', '0', '301', ['1', '99', '100', '101']);
  });

  it('awkward amounts (1, 2, 3, 99, 100, 301 AMD) with every split and many partial sequences', () => {
    const grosses = ['1', '2', '3', '99', '100', '301'];
    let cases = 0;
    for (const gross of grosses) {
      const g = Number(gross);
      for (let b = 0; b <= g; b += Math.max(1, Math.floor(g / 7))) {
        for (let p = 0; p <= g - b; p += Math.max(1, Math.floor((g - b) / 5) || 1)) {
          // Three sequences: single full refund, unit steps, and 0.0001 quanta.
          assertProperties(gross, String(b), String(p), [gross]);
          const units: string[] = [];
          for (let t = 0; t < g; t += 1) units.push('1');
          assertProperties(gross, String(b), String(p), units);
          assertProperties(gross, String(b), String(p), ['0.0001', '0.0002', String(g - 0.0003)]);
          cases += 3;
        }
      }
    }
    expect(cases).toBeGreaterThan(100);
  });

  it('pseudo-random partial sequences on fractional splits keep every property', () => {
    // Deterministic LCG so a failure is reproducible.
    let seed = 20260921;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 200; n += 1) {
      const gross = D(Math.floor(rnd() * 100000) + 1).plus(D(Math.floor(rnd() * 10000)).dividedBy(10000));
      const bonus = gross.times(rnd()).toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const prepaid = gross.minus(bonus).times(rnd()).toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const refunds: string[] = [];
      let left = gross;
      while (left.greaterThan(0)) {
        const cut = Decimal.min(left, gross.times(rnd()).toDecimalPlaces(4, Decimal.ROUND_UP));
        const piece = cut.greaterThan(0) ? cut : left;
        refunds.push(piece.toString());
        left = left.minus(piece);
      }
      assertProperties(gross.toString(), bonus.toString(), prepaid.toString(), refunds);
    }
  });
});
