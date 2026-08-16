import { IsString, IsUUID, Length } from 'class-validator';
import { IsCommissionRateBps } from '../../../common/validators/is-commission-rate-bps.validator';

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

  @IsCommissionRateBps()
  bonusAccrualRateBps: number;

  @IsUUID()
  ownerUserId: string;
}
