import { registerDecorator, ValidationOptions } from 'class-validator';

/** 0.5%, 1.0%, 1.5%, ... 20% — the only rates TuTak negotiates with a partner. */
export const COMMISSION_RATE_STEP_BPS = 50;
export const COMMISSION_RATE_MIN_BPS = 50;
export const COMMISSION_RATE_MAX_BPS = 2000;

export function isCommissionRateBps(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= COMMISSION_RATE_MIN_BPS &&
    value <= COMMISSION_RATE_MAX_BPS &&
    value % COMMISSION_RATE_STEP_BPS === 0
  );
}

/**
 * Restricts `bonusAccrualRateBps` to the fixed rate card — 0.5% steps from
 * 0.5% to 20% — instead of any basis-point value up to 100%. Applied at the
 * DTO boundary for a clean 400; `PartnersService` re-checks the same
 * predicate so an internal caller that skips the DTO can't bypass it either,
 * and a DB CHECK constraint (see the matching migration) makes an off-grid
 * value unrepresentable even if both layers are somehow skipped.
 */
export function IsCommissionRateBps(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCommissionRateBps',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isCommissionRateBps(value);
        },
        defaultMessage() {
          return (
            `bonusAccrualRateBps must be a multiple of ${COMMISSION_RATE_STEP_BPS} ` +
            `between ${COMMISSION_RATE_MIN_BPS} and ${COMMISSION_RATE_MAX_BPS} ` +
            `(0.5% steps from 0.5% to 20%)`
          );
        },
      },
    });
  };
}
