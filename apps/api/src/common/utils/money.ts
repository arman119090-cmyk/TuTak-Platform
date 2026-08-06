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
