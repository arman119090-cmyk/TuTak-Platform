import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { RoleName } from '@prisma/client';

/**
 * An owner offering somebody a job.
 *
 * `partnerId` is not here on purpose: it comes from the path and is checked
 * against the caller's scope. A partner id in a body is a partner id an
 * attacker chooses.
 */
export class InvitePartnerStaffDto {
  /** Armenian E.164. The same shape the rest of the platform accepts. */
  @Matches(/^\+374\d{8}$/, { message: 'phone must be an Armenian number in +374XXXXXXXX form' })
  phone: string;

  /**
   * Staff or manager. The service refuses anything else — the validator is
   * the first no, not the only one, because a validator is a spelling rule
   * and this is a privilege boundary.
   */
  @IsEnum(RoleName)
  role: RoleName;

  /** Branches to post them to on acceptance. May be empty. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  branchIds?: string[];
}

/** What an invited person sends back, having received the token on their phone. */
export class AcceptPartnerStaffInvitationDto {
  @IsString()
  token: string;
}
