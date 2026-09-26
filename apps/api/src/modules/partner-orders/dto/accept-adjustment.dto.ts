import { IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/**
 * Accepting a sourcing proposal (spec §39-41). For a price increase the
 * customer chooses how to fund the difference, exactly like the original
 * checkout; ignored otherwise.
 */
export class AcceptAdjustmentDto {
  @IsMoneyString({ allowZero: true })
  @IsOptional()
  discountAmount?: string;

  @IsMoneyString({ allowZero: true })
  @IsOptional()
  tutakMoneyAmount?: string;

  @IsString()
  @Length(8, 100)
  @IsOptional()
  idempotencyKey?: string;
}
