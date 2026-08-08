import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export type Money = Decimal | number | string;

/** Column precision is Decimal(18,4): 14 integer digits, 4 fractional. */
export const MONEY_SCALE = 4;
export const MONEY_MAX = new Decimal('99999999999999.9999');

export const toDecimal = (value: Money): Decimal =>
  value instanceof Decimal ? value : new Decimal(value);

export const isPositive = (value: Money): boolean => toDecimal(value).greaterThan(0);

export const sumDecimals = (values: Money[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));

/**
 * Parses a caller-supplied monetary value and rejects everything that is not
 * a finite, in-range, correctly-scaled number.
 *
 * This exists because `class-validator`'s @IsNumberString happily accepts
 * "-1000000", "1e40" and "NaN". A negative amount reaching the QR redemption
 * path inverted `amount.minus(bonus)` into an addition and let any user mint
 * unlimited points; see docs/AUDIT_2026-08.md §B1.
 *
 * @param allowZero  redemptions may be zero; accruals may not.
 */
export function parseMoney(
  value: Money,
  field: string,
  { allowZero = true }: { allowZero?: boolean } = {},
): Decimal {
  let decimal: Decimal;
  try {
    decimal = toDecimal(value);
  } catch {
    throw new BadRequestException(`${field} is not a valid number`);
  }

  if (!decimal.isFinite()) {
    throw new BadRequestException(`${field} must be a finite number`);
  }
  if (decimal.isNegative()) {
    throw new BadRequestException(`${field} must not be negative`);
  }
  if (!allowZero && decimal.isZero()) {
    throw new BadRequestException(`${field} must be greater than zero`);
  }
  if (decimal.greaterThan(MONEY_MAX)) {
    throw new BadRequestException(`${field} exceeds the maximum supported amount`);
  }
  if (decimal.decimalPlaces() > MONEY_SCALE) {
    throw new BadRequestException(`${field} supports at most ${MONEY_SCALE} decimal places`);
  }
  return decimal;
}

/** Strictly positive variant — accruals, reservations, adjustments. */
export const parsePositiveMoney = (value: Money, field: string): Decimal =>
  parseMoney(value, field, { allowZero: false });

/**
 * Rounds a *computed* monetary value to what the column can hold.
 *
 * `parseMoney` guards amounts that arrive from outside and refuses more than
 * four decimal places. That is right for input and wrong for arithmetic: the
 * platform's own multiplications routinely produce more.
 *
 *   energy(3 dp) × tariff(2 dp)        = 5 dp
 *   amount(4 dp) × bps ÷ 10⁴           = 8 dp
 *
 * Unrounded, those values reached `parseMoney` and were refused — so a
 * charging session with a fractional meter reading at a fractional tariff
 * could not be stopped, and an accrual on a fractional amount failed the
 * payment that earned it. Whole amounts and round rates divide cleanly, which
 * is why it took deliberately awkward numbers to see.
 *
 * Two modes, and the split is not arbitrary:
 *
 * - **What the customer pays** rounds half up. That is the retail convention
 *   and what a receipt is expected to show.
 * - **What the platform issues** rounds down. Points are a liability; the
 *   platform should never owe more than the rate says because of a rounding
 *   step. A sub-0.0001 accrual therefore becomes zero rather than failing the
 *   purchase.
 *
 * Both match what the financial core already does at its own arithmetic —
 * see the commission in `payment-engine` and the accrual in `settlement`.
 * This puts the loyalty and EV paths on the same footing rather than
 * inventing a third convention.
 */
export const roundCharge = (value: Money): Decimal =>
  toDecimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);

/** Rounds an issued liability down. See `roundCharge` for why they differ. */
export const roundIssued = (value: Money): Decimal =>
  toDecimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN);
