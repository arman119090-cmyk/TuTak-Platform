import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import type { UpdateAvatarConsentRequestDto } from '../media.contracts';

export class UpdateAvatarConsentDto implements UpdateAvatarConsentRequestDto {
  /**
   * Spec §1.4/§3.3. The default is false and stays false until the customer
   * says otherwise — there is no path anywhere that turns this on implicitly,
   * as a side effect of uploading an avatar, or "because they seemed fine
   * with it". Consent that was not actively given is not consent.
   */
  @ApiProperty({ description: 'Show my avatar in my inviter’s Level-1 referral list' })
  @IsBoolean()
  showAvatarInReferralList!: boolean;
}
