import { IsOptional, IsString, Length } from 'class-validator';
import { IsCommissionRateBps } from '../../../common/validators/is-commission-rate-bps.validator';

/**
 * Self-service application — spec §2. Unlike `CreatePartnerDto` (admin-only,
 * activates immediately), this creates a partner in `PENDING_APPROVAL`: it
 * cannot redeem, accrue, or confirm a PurchaseIntent until an admin approves
 * it. The applicant becomes the new partner's owner automatically — there is
 * no `ownerUserId` field to fill in, unlike the admin path.
 */
export class ApplyPartnerDto {
  @IsString()
  @Length(2, 200)
  legalName: string;

  @IsString()
  @Length(2, 100)
  displayName: string;

  /**
   * Optional on purpose. This form is the first contact with a business that
   * has not agreed to anything yet, and a required tax number turns away the
   * applicant rather than producing the number. It can be filled in from the
   * partner's own panel once they are in.
   */
  @IsOptional()
  @IsString()
  @Length(5, 30)
  taxId?: string;

  @IsString()
  @Length(2, 50)
  category: string;

  /**
   * The applicant proposes a rate; it is not binding. `docs/PARTNER_TERMS.md`
   * already establishes that commercial terms are negotiated with TuTak, not
   * self-set — this is a starting point for that conversation, applied only
   * once an admin approves.
   */
  @IsCommissionRateBps()
  bonusAccrualRateBps: number;
}
