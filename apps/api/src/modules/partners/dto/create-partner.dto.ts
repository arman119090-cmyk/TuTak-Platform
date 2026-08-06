import { IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  @Length(2, 200)
  legalName: string;

  @IsString()
  @Length(2, 100)
  displayName: string;

  @IsString()
  @Length(5, 30)
  taxId: string;

  @IsString()
  @Length(2, 50)
  category: string;

  @IsInt()
  @Min(0)
  @Max(10_000)
  bonusAccrualRateBps: number;

  @IsUUID()
  ownerUserId: string;
}
