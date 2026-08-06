import { IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class RedeemQrDto {
  @IsString()
  @Length(8, 128)
  token: string;

  @IsOptional()
  @IsMoneyString()
  bonusAmountToApply?: string;

  /** Bounded so a caller cannot store unbounded data via the unique index. */
  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}
