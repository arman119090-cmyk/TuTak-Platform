import { IsInt, IsString, Length, Max, Min } from 'class-validator';

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

  @IsString()
  @Length(5, 30)
  taxId: string;

  @IsString()
  @Length(2, 50)
  category: string;

  /**
   * The applicant proposes a rate; it is not binding. `docs/PARTNER_TERMS.md`
   * already establishes that commercial terms are negotiated with TuTak, not
   * self-set — this is a starting point for that conversation, applied only
   * once an admin approves.
   */
  @IsInt()
  @Min(0)
  @Max(10_000)
  bonusAccrualRateBps: number;
}
