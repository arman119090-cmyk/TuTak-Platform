import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PartnerPromoDestination } from '@prisma/client';
import { PromoTranslationsDto, TranslationsField } from './promo-copy.dto';

/**
 * A platform administrator writes one Home "Partner Spotlight" card.
 *
 * The words live in `translations`, one entry per interface language; at
 * least one language must be complete or the service refuses the card (an
 * unfilled card is not a card). Nothing here is a URL — see
 * `PartnerPromoDestination`.
 */
export class CreatePromoDto {
  @IsUUID()
  partnerId: string;

  @TranslationsField()
  translations: PromoTranslationsDto;

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
