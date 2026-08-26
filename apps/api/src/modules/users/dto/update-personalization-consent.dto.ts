import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Mirrors `UpdatePersonalizationConsentRequestDto` in `@tutak/shared-types`
 * — not imported directly, same reason `UpdateAvatarConsentDto` doesn't
 * import its own shared-types counterpart either: the API's `rootDir` is
 * its own `src`, and importing across the workspace breaks its build.
 */
export class UpdatePersonalizationConsentDto {
  /**
   * The default is false and stays false until the customer says otherwise —
   * same reasoning as `UpdateAvatarConsentDto.showAvatarInReferralList`.
   * Nothing about this ever turns on as a side effect of another action.
   */
  @ApiProperty({ description: 'Rank nearby partners by my own purchase history' })
  @IsBoolean()
  personalizedRecommendationsEnabled!: boolean;
}
