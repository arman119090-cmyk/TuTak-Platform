import { IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/** A full (no amount) or partial return after completion (spec §44). */
export class CreateReturnDto {
  @IsMoneyString({ allowZero: false })
  @IsOptional()
  amount?: string;

  @IsString()
  @Length(3, 500)
  reason: string;

  @IsString()
  @Length(8, 100)
  idempotencyKey: string;
}
