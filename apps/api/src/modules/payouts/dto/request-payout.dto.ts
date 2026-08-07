import { IsString, IsUUID, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class RequestPayoutDto {
  @IsUUID()
  partnerId: string;

  @IsMoneyString({ allowZero: false })
  amount: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}

export class ConfirmPayoutDto {
  /** The bank's own reference, so a transfer can be traced from both ends. */
  @IsString()
  @Length(1, 200)
  bankReference: string;
}

export class FailPayoutDto {
  @IsString()
  @Length(3, 500)
  failureReason: string;
}
