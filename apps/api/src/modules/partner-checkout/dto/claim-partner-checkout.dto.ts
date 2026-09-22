import { PaymentRoute } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional } from 'class-validator';

/**
 * How the customer funds a till-opened purchase. The gross is the till's;
 * the customer chooses only the sources, exactly as on the QR path.
 */
export class ClaimPartnerCheckoutDto {
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
