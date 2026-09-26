import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { IsCommissionRateBps } from '../../../common/validators/is-commission-rate-bps.validator';

export class CreatePartnerDto {
  @IsString()
  @Length(2, 200)
  legalName: string;

  @IsString()
  @Length(2, 100)
  displayName: string;

  /**
   * Optional here for the same reason it is optional on `ApplyPartnerDto`:
   * the column holds no number for a partner that has not supplied one, and
   * requiring it on this path only would refuse an administrator adding a
   * business they met in person, whose ՀՎՀՀ is not in the room.
   */
  @IsOptional()
  @IsString()
  @Length(5, 30)
  taxId?: string;

  @IsString()
  @Length(2, 50)
  category: string;

  @IsCommissionRateBps()
  bonusAccrualRateBps: number;

  @IsUUID()
  ownerUserId: string;

  /** Meaningful only when `category` is `"fuel"` — see `Partner.sellsGas`. */
  @IsOptional()
  @IsBoolean()
  sellsGas?: boolean;

  /** Meaningful only when `category` is `"fuel"` — see `Partner.sellsPetrol`. */
  @IsOptional()
  @IsBoolean()
  sellsPetrol?: boolean;
}
