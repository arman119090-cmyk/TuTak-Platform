import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PartnerPromoDestination } from '@prisma/client';

/**
 * Everything but the partner: a card that should belong to another business
 * is a different card, not an edit — its artwork is scoped to the partner it
 * was uploaded for, and moving the card would orphan that.
 *
 * Spelled out rather than derived with a mapped type so that the caps stay
 * visibly the same as `CreatePromoDto`'s; a drift between the two would be a
 * card that can be edited into a shape it could not have been created in.
 */
export class UpdatePromoDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 24)
  benefitLabel?: string;

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
