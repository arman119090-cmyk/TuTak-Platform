import { IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/**
 * A partner enters only the merchandise refund amount — never a bonus figure,
 * never anything about real money. TuTak derives every loyalty reversal from
 * this one number; the partner repays the customer's money outside TuTak.
 */
export class RefundPurchaseIntentDto {
  /** Omit for a full refund of whatever merchandise value remains unrefunded. */
  @IsOptional()
  @IsMoneyString({ allowZero: false })
  amount?: string;

  @IsString()
  @Length(3, 500)
  reason: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}
