import { PaymentRoute } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional, IsUUID } from 'class-validator';

/**
 * What the customer's app asks before it shows a checkout breakdown: "for
 * this gross at this partner, with this much bonus and this much of my
 * money, what will I actually owe at the till?"
 *
 * The answer is the server's, not the client's — see
 * `PurchaseFundingService.quote`. The client picks *sources*; every amount
 * on screen comes back from here.
 */
export class QuotePurchaseIntentDto {
  @IsUUID()
  partnerId: string;

  @IsUUID()
  @IsOptional()
  partnerBranchId?: string;

  @IsNumberString()
  grossAmount: string;

  @IsNumberString()
  @IsOptional()
  bonusAmountRequested?: string;

  @IsNumberString()
  @IsOptional()
  prepaidAmountApplied?: string;

  @IsEnum(PaymentRoute)
  @IsOptional()
  paymentRoute?: PaymentRoute;
}
