import { ContributionRuleKind } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { roundIssued } from '../../../common/utils/money';

/**
 * How much of a sale is TuTak's, under one partner's commercial terms.
 *
 * ## One function, deliberately
 *
 * Arman's instruction of 15.09.2026 was explicit: implement `FIXED_PER_UNIT`
 * **without duplicating the ledger economics**. This is what that means in
 * practice. The whole of the money model — the pool split into green,
 * deferred and three referrer legs, `PARTNER_PAYABLE` debited by the pool,
 * the bonus-redemption compensation, refund reversal — depends on exactly one
 * number: `pool`. Nothing downstream asks *how* that number was arrived at.
 *
 * So a new pricing shape is a new branch in here and nothing else. There is
 * no second posting, no second settlement path, no "per-unit partner" fork
 * anywhere in `settlePurchase`. If a second copy of this arithmetic ever
 * appears, the two will disagree on a Tuesday and a partner will be paid the
 * wrong amount with both numbers looking defensible.
 *
 * ## Rounding
 *
 * `roundIssued` — down — for the same reason `settlePurchase` always used it:
 * the pool is a liability the platform issues against itself, and rounding an
 * issued liability up mints value nobody funded. A per-unit rule usually
 * lands exact (10 × 50 = 500), but 10 AMD per litre × 12.345 L does not, and
 * the rule must be the same rule in both cases.
 */
export interface ContributionTerms {
  kind: ContributionRuleKind;
  percentBps: number | null;
  fixedPerUnit: Decimal | null;
  unit: string | null;
}

export interface ContributionBasis {
  grossAmount: Decimal;
  quantity: Decimal | null;
  quantityUnit: string | null;
}

export class ContributionRuleError extends Error {}

/**
 * The contribution under an explicit rule.
 *
 * Throws rather than guessing when the purchase and the terms do not fit: a
 * per-unit rule with no quantity has no answer, and inventing one (zero? the
 * gross?) would be inventing money. The database refuses the same combination
 * — see `purchase_intent_rule_snapshot_matches` — so reaching this throw
 * means a caller skipped the create path, not that a customer did something
 * unusual.
 */
export function contributionUnderRule(
  terms: ContributionTerms,
  basis: ContributionBasis,
): Decimal {
  const percentPart = (): Decimal => {
    if (terms.percentBps === null) {
      throw new ContributionRuleError(`${terms.kind} terms carry no percentage`);
    }
    return basis.grossAmount.times(terms.percentBps).dividedBy(10_000);
  };

  const perUnitPart = (): Decimal => {
    if (terms.fixedPerUnit === null || terms.unit === null) {
      throw new ContributionRuleError(`${terms.kind} terms carry no per-unit amount`);
    }
    if (basis.quantity === null || basis.quantityUnit === null) {
      throw new ContributionRuleError(
        'These terms are priced per unit, but this purchase records no quantity',
      );
    }
    if (basis.quantityUnit !== terms.unit) {
      // Not pedantry. 10 AMD per litre applied to a quantity measured in
      // kilograms produces a number, and that number is wrong by whatever
      // the density happens to be.
      throw new ContributionRuleError(
        `This purchase is measured in ${basis.quantityUnit} but its terms are per ${terms.unit}`,
      );
    }
    return basis.quantity.times(terms.fixedPerUnit);
  };

  switch (terms.kind) {
    case ContributionRuleKind.PERCENT_BPS:
      return roundIssued(percentPart());
    case ContributionRuleKind.FIXED_PER_UNIT:
      return roundIssued(perUnitPart());
    case ContributionRuleKind.HYBRID:
      // Rounded once, at the end. Rounding each leg and adding would lose a
      // fraction on every hybrid sale, always in the platform's favour, which
      // is precisely the kind of quiet drift a partner is right to distrust.
      return roundIssued(percentPart().plus(perUnitPart()));
  }
}

/**
 * The contribution for a purchase, whether or not it names a rule.
 *
 * The fallback is the point. Every purchase made before 15.09.2026, and every
 * partner who has never had a rule row written, has `contributionRuleId` null
 * and `negotiatedRateBps` set — and must keep being priced exactly as it was.
 * Arman's decision is explicit that existing percentage partners are not to
 * be broken, and "not broken" means the arithmetic is byte-identical, not
 * merely similar: `grossAmount × bps ÷ 10000`, rounded down, which is what
 * `settlePurchase` has always done.
 */
export function contributionForPurchase(
  purchase: {
    grossAmount: Decimal;
    quantity: Decimal | null;
    quantityUnit: string | null;
    negotiatedRateBps: number;
    contributionRuleKind: ContributionRuleKind | null;
  },
  rule: ContributionTerms | null,
): Decimal {
  if (rule === null || purchase.contributionRuleKind === null) {
    return roundIssued(purchase.grossAmount.times(purchase.negotiatedRateBps).dividedBy(10_000));
  }
  return contributionUnderRule(rule, {
    grossAmount: purchase.grossAmount,
    quantity: purchase.quantity,
    quantityUnit: purchase.quantityUnit,
  });
}
