import { IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/**
 * "Подтвердить заказ" (spec §4, Q1 = C). The customer chooses how much comes
 * from the green discount balance and how much from their TuTak money; the
 * rest is paid to the partner directly (external). Logging in is never
 * consent to buy — only this call is.
 */
export class SubmitPartnerOrderDto {
  @IsMoneyString({ allowZero: true })
  @IsOptional()
  discountAmount?: string;

  @IsMoneyString({ allowZero: true })
  @IsOptional()
  tutakMoneyAmount?: string;

  /** A retried confirmation with the same key never captures twice. */
  @IsString()
  @Length(8, 100)
  idempotencyKey: string;
}
