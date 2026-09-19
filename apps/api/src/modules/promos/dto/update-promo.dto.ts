import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PartnerPromoDestination } from '@prisma/client';
import { PromoTranslationsDto, TranslationsField } from './promo-copy.dto';

/**
 * Everything but the partner: a card that should belong to another business
 * is a different card, not an edit — its artwork is scoped to the partner it
 * was uploaded for, and moving the card would orphan that.
 *
 * `translations`, when sent, replaces the whole object: the admin form
 * always shows and submits all three languages together, so a partial merge
 * would only make "I cleared the English" impossible to express.
 */
export class UpdatePromoDto {
  @IsOptional()
  @TranslationsField()
  translations?: PromoTranslationsDto;

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
