import { validateSync } from 'class-validator';
import { IsMoneyString } from './is-money-string.validator';

class AmountDto {
  @IsMoneyString()
  amount: unknown;
}

class StrictAmountDto {
  @IsMoneyString({ allowZero: false })
  amount: unknown;
}

const errorsFor = (value: unknown, Ctor: typeof AmountDto | typeof StrictAmountDto = AmountDto) => {
  const dto = new Ctor();
  dto.amount = value;
  return validateSync(dto);
};

/**
 * The DTO boundary is the first of three layers (validator → parseMoney →
 * CHECK constraint). Every value listed here as rejected was accepted by the
 * `@IsNumberString()` this decorator replaced.
 */
describe('IsMoneyString', () => {
  it.each([
    ['-1000000', 'negative — the original mint-points exploit'],
    ['-0.0001', 'negative fraction'],
    ['1e40', 'exponential notation overflowing the column'],
    ['NaN', 'not a number'],
    ['Infinity', 'not finite'],
    ['0x10', 'hexadecimal'],
    ['1.00005', 'more precision than Decimal(18,4) stores'],
    ['100000000000000', 'more integer digits than the column holds'],
    ['1,000', 'thousands separator'],
    [' 100 ', 'surrounding whitespace'],
    ['', 'empty string'],
    ['+100', 'explicit sign'],
  ])('rejects %p (%s)', (value) => {
    expect(errorsFor(value)).toHaveLength(1);
  });

  it.each([100, 1.5, null, undefined, {}, [], true])(
    'rejects the non-string %p — numbers lose precision in JSON',
    (value) => {
      expect(errorsFor(value)).toHaveLength(1);
    },
  );

  it.each(['0', '0.0001', '1', '1000.5', '99999999999999.9999'])('accepts %p', (value) => {
    expect(errorsFor(value)).toHaveLength(0);
  });

  describe('allowZero: false', () => {
    it.each(['0', '0.0', '0.0000'])('rejects %p where a movement is required', (value) => {
      expect(errorsFor(value, StrictAmountDto)).toHaveLength(1);
    });

    it('still accepts the smallest representable amount', () => {
      expect(errorsFor('0.0001', StrictAmountDto)).toHaveLength(0);
    });
  });
});
