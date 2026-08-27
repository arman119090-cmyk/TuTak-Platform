import { IsString, IsUUID, Length } from 'class-validator';

/** Customer-facing: a logged-in TuTak user linking their own roaming-CPO account. */
export class LinkRoamingCpoCustomerDto {
  @IsUUID()
  partnerId: string;

  @IsString()
  @Length(1, 128)
  externalCustomerId: string;
}
