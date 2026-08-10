import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PARTNER_CATEGORIES, type PartnerCategory } from '../geo';

/**
 * Where the customer is, and what they are looking for.
 *
 * Latitude and longitude are required rather than optional-with-a-default:
 * a default centre would silently answer "nothing near you" for anybody it
 * guessed wrong about, and a screen that is empty for a reason nobody can see
 * is worse than one that says it needs a location.
 */
export class NearbyPartnersQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  /**
   * Capped at 50km. Not a performance guard — the bounding box below is cheap
   * — but a product one: a shop an hour's drive away is not "nearby", and
   * returning it makes the list useless at the top where it matters.
   */
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(50)
  radiusKm?: number = 10;

  /** One of the filter chips. Absent means all of them. */
  @ApiPropertyOptional({ enum: PARTNER_CATEGORIES })
  @IsOptional()
  @IsIn(PARTNER_CATEGORIES)
  category?: PartnerCategory;

  /** Free text over the partner's display name, its branch and the address. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
