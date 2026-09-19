import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PartnerPromoDestination } from '@prisma/client';

/**
 * A platform administrator writes one Home "Partner Spotlight" card.
 *
 * The caps are the card's own: a title that needs more than 80 characters
 * does not fit on a 16:10 card with the artwork still visible, and a benefit
 * label is two or three words ("10% кешбэк") by definition. Nothing here is
 * a URL — see `PartnerPromoDestination`.
 */
export class CreatePromoDto {
  @IsUUID()
  partnerId: string;

  @IsString()
  @Length(1, 80)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subtitle?: string | null;

  @IsString()
  @Length(1, 24)
  benefitLabel: string;

  @IsOptional()
  @IsEnum(PartnerPromoDestination)
  destination?: PartnerPromoDestination;

  @IsOptional()
  @IsBoolean()
  sponsored?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;
}
