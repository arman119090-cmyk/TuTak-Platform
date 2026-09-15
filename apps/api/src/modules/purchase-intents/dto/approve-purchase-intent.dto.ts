import { UnitOfMeasure } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional, IsString, Length } from 'class-validator';

/**
 * What a member of staff types back to say they have seen what is being sold.
 *
 * Every field is what the *cashier* read off the pump or the till, not what
 * the customer's app said. `approveForPayment` compares them to the stored
 * snapshot and refuses a mismatch, which is the whole mechanism: a customer
 * who typed 500 litres cannot get past somebody who saw 50 in front of them.
 *
 * Optional for a percentage partner — there is no line item to check, and
 * demanding one would train staff to type numbers they never looked at. For
 * `FIXED_PER_UNIT` and `HYBRID` terms all three are required, because the
 * quantity is what the platform's own share is calculated from.
 */
export class ApprovePurchaseIntentDto {
  @IsNumberString()
  @IsOptional()
  quantity?: string;

  @IsEnum(UnitOfMeasure)
  @IsOptional()
  quantityUnit?: UnitOfMeasure;

  @IsNumberString()
  @IsOptional()
  unitPrice?: string;

  /** The gross the cashier sees on their own screen. */
  @IsNumberString()
  @IsOptional()
  grossAmount?: string;

  @IsString()
  @Length(0, 200)
  @IsOptional()
  note?: string;
}
