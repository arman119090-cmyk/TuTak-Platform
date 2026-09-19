import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * One language of a Home "Partner Spotlight" card.
 *
 * The caps are the card's own: a title that needs more than 80 characters
 * does not fit on a 16:10 card with the artwork still visible, and a benefit
 * label is two or three words ("10% кешбэк") by definition. A locale that is
 * sent at all must be complete — the admin panel omits the languages left
 * blank rather than sending empty strings, so a half-filled language is a
 * validation error here, not an empty card on a phone.
 */
export class PromoCopyDto {
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
}

/** `{ hy?, ru?, en? }` — each present locale validated as a `PromoCopyDto`. */
export class PromoTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PromoCopyDto)
  hy?: PromoCopyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromoCopyDto)
  ru?: PromoCopyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromoCopyDto)
  en?: PromoCopyDto;
}

/** Shared by create and update: the whole object, validated locale by locale. */
export function TranslationsField() {
  return function (target: object, propertyKey: string) {
    IsObject()(target, propertyKey);
    ValidateNested()(target, propertyKey);
    Type(() => PromoTranslationsDto)(target, propertyKey);
  };
}
