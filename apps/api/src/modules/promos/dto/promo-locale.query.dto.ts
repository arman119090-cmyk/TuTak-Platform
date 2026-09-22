import { IsIn, IsOptional } from 'class-validator';
import { PROMO_LOCALES, type PromoLocale } from '../promo-translations';

/** `?locale=hy` — the interface language the app is currently showing. */
export class PromoLocaleQueryDto {
  @IsOptional()
  @IsIn(PROMO_LOCALES)
  locale?: PromoLocale;
}
