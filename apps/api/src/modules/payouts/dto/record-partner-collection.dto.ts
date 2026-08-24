import { IsString, IsUUID, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class RecordPartnerCollectionDto {
  @IsUUID()
  partnerId: string;

  @IsMoneyString({ allowZero: false })
  amount: string;

  /** The partner's own bank transfer reference, from the statement. */
  @IsString()
  @Length(1, 200)
  bankReference: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}
