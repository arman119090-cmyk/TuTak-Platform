import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Spec (partner public profile, confirmed 2026-08-23): the partner's own
 * "about" text. `@IsOptional` also covers `null`, which is how a partner
 * clears a previously-written about text — class-validator skips every
 * decorator below it when the value is `null` or `undefined`, so both mean
 * "no text supplied here" and reach the service as-is.
 *
 * 2000 characters — a short "about us" paragraph, well past `ApplyPartnerDto`'s
 * 200-char `legalName` cap because this is prose rather than a business name,
 * short of anything that would make the partner page unreadable.
 */
export class UpdatePartnerAboutDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string | null;
}
