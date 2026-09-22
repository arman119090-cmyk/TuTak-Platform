import { ContributionRuleKind, UnitOfMeasure } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ContributionRuleError,
  contributionForPurchase,
  contributionUnderRule,
} from './contribution-rule';

/**
 * The one number the whole money model depends on.
 *
 * `settlePurchase` splits `pool` into green, deferred and three referrer legs,
 * debits `PARTNER_PAYABLE` by it and reverses exactly it on a refund. Nothing
 * downstream asks how it was arrived at — so every pricing shape has to be
 * right *here*, and until now this function had only incidental coverage
 * through integration suites that were testing something else.
 */
describe('contributionForPurchase', () => {
  const percentRule = (percentBps: number) => ({
    kind: ContributionRuleKind.PERCENT_BPS,
    percentBps,
    fixedPerUnit: null,
    unit: null,
  });

  /**
   * Why there is no migration back-filling a rule row onto every partner.
   *
   * The product decision of 15.09.2026 is that existing percentage partners must
   * not be broken, and "not broken" means byte-identical, not similar. These
   * cases prove that a partner with no rule at all is priced exactly as one
   * carrying the equivalent `PERCENT_BPS` rule — so the absence of a rule row
   * is not a second-class state that needs migrating away.
   *
   * That matters because back-filling cannot be done honestly. An `ACTIVE`
   * rule must name the person who approved it (`partner_contribution_rules_
   * in_force_was_approved`), and a migration has no such person. Writing one
   * in would launder the maker/checker control that constraint exists to
   * enforce. A partner moves onto an explicit rule when two people put them
   * there, through `propose`/`approve`; until then the fallback prices them
   * correctly, and these tests are what says so.
   */
  describe('a partner with no rule is priced exactly like one with the equivalent rule', () => {
    it.each([
      ['300 bps on 15,000', 300, '15000'],
      ['500 bps on 4,999', 500, '4999'],
      // Deliberately a case that does not divide evenly: 7,777 × 350 ÷ 10000
      // = 272.195, where rounding is the whole question.
      ['350 bps on 7,777', 350, '7777'],
      ['1 bp on 1', 1, '1'],
      ['2000 bps on 123.45', 2000, '123.45'],
    ])('%s', (_label, bps, gross) => {
      const basis = {
        grossAmount: new Decimal(gross),
        quantity: null,
        quantityUnit: null,
        negotiatedRateBps: bps,
        contributionRuleKind: null,
      };

      const withoutRule = contributionForPurchase(basis, null);
      const withRule = contributionForPurchase(
        { ...basis, contributionRuleKind: ContributionRuleKind.PERCENT_BPS },
        percentRule(bps),
      );

      expect(withRule.toFixed(4)).toBe(withoutRule.toFixed(4));
    });
  });

  it('rounds the issued liability down, never up', () => {
    // 7,777.77 × 350 ÷ 10000 = 272.221950 — six decimals, where the money
    // scale is four. Rounding up would mint liability nobody funded, on
    // every such sale; down is the only safe direction for a liability the
    // platform issues against itself.
    //
    // Note the scale: `roundIssued` rounds at four decimals, not two. My
    // first version of this test asserted 272.19 against an input that was
    // already exact at four, which proved nothing about rounding at all.
    const pool = contributionForPurchase(
      {
        grossAmount: new Decimal('7777.77'),
        quantity: null,
        quantityUnit: null,
        negotiatedRateBps: 350,
        contributionRuleKind: null,
      },
      null,
    );
    expect(pool.toFixed(4)).toBe('272.2219');
  });
});

describe('contributionUnderRule', () => {
  /** The worked HAZE example: 50 L × 300 = 15,000; TuTak = 50 × 10 = 500. */
  it('prices HAZE per litre, not as a percentage', () => {
    const pool = contributionUnderRule(
      {
        kind: ContributionRuleKind.FIXED_PER_UNIT,
        percentBps: null,
        fixedPerUnit: new Decimal('10'),
        unit: UnitOfMeasure.LITER,
      },
      {
        grossAmount: new Decimal('15000'),
        quantity: new Decimal('50'),
        quantityUnit: UnitOfMeasure.LITER,
      },
    );
    expect(pool.toFixed(4)).toBe('500.0000');
  });

  it('rounds a hybrid once at the end, not leg by leg', () => {
    // 0.5% of 1,001 = 5.005 and 0.5 per unit × 3.003 = 1.5015. Rounded
    // separately: 5.00 + 1.50 = 6.50. Rounded once: 6.5065 → 6.5065.
    const pool = contributionUnderRule(
      {
        kind: ContributionRuleKind.HYBRID,
        percentBps: 50,
        fixedPerUnit: new Decimal('0.5'),
        unit: UnitOfMeasure.LITER,
      },
      {
        grossAmount: new Decimal('1001'),
        quantity: new Decimal('3.003'),
        quantityUnit: UnitOfMeasure.LITER,
      },
    );
    expect(pool.toFixed(4)).toBe('6.5065');
  });

  /**
   * A per-unit rule applied to a quantity in the wrong unit produces a
   * number, and that number is wrong by whatever the density happens to be.
   * Refusing is the only safe answer.
   */
  it('refuses a quantity measured in the wrong unit', () => {
    expect(() =>
      contributionUnderRule(
        {
          kind: ContributionRuleKind.FIXED_PER_UNIT,
          percentBps: null,
          fixedPerUnit: new Decimal('10'),
          unit: UnitOfMeasure.LITER,
        },
        {
          grossAmount: new Decimal('15000'),
          quantity: new Decimal('50'),
          quantityUnit: UnitOfMeasure.KWH,
        },
      ),
    ).toThrow(ContributionRuleError);
  });

  it('refuses per-unit terms on a purchase that records no quantity', () => {
    expect(() =>
      contributionUnderRule(
        {
          kind: ContributionRuleKind.FIXED_PER_UNIT,
          percentBps: null,
          fixedPerUnit: new Decimal('10'),
          unit: UnitOfMeasure.LITER,
        },
        { grossAmount: new Decimal('15000'), quantity: null, quantityUnit: null },
      ),
    ).toThrow(/records no quantity/);
  });
});
