import { IsBoolean, IsUUID } from 'class-validator';

/** Owner/admin granting or revoking a trusted `PARTNER_MANAGER`'s all-branch reach — `UserRole.allBranches`. */
export class SetAllBranchesDto {
  @IsUUID()
  userId: string;

  @IsBoolean()
  allBranches: boolean;
}
