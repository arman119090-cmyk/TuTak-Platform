import { IsString, IsUUID, Length } from 'class-validator';

/** Customer-facing: a logged-in TuTak user linking their own FastCharge account. */
export class LinkFastChargeCustomerDto {
  @IsUUID()
  partnerId: string;

  @IsString()
  @Length(1, 128)
  fastChargeCustomerId: string;
}
