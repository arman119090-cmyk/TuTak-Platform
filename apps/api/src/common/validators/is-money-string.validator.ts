import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const MONEY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * Accepts only a non-negative decimal string within Decimal(18,4).
 *
 * `@IsNumberString()` — which this replaces on every monetary field —
 * accepts "-1000000", "1e40", "NaN" and "Infinity". Each of those reached
 * the bonus maths before this validator existed.
 *
 * Rejecting at the DTO boundary gives the caller a clean 400; the domain
 * services re-check via parseMoney() so a future internal caller cannot
 * bypass the rule, and CHECK constraints in Postgres make the bad state
 * unrepresentable even if both layers are somehow skipped.
 */
export function IsMoneyString(
  options: { allowZero?: boolean } = {},
  validationOptions?: ValidationOptions,
) {
  const { allowZero = true } = options;

  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMoneyString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          if (!MONEY_PATTERN.test(value)) return false;
          if (!allowZero && Number(value) === 0) return false;
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a non-negative amount with at most 4 decimal places${
            allowZero ? '' : ', greater than zero'
          }`;
        },
      },
    });
  };
}
