import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { BranchStaffRole } from '@prisma/client';

/**
 * Puts an existing `PARTNER_STAFF`/`PARTNER_MANAGER` in charge of one
 * branch. Does not create the underlying `UserRole` — an owner/admin must
 * already have granted the person partner-scoped access the ordinary way
 * (`AdminService.assignRole`); this only narrows *which* branch(es) that
 * access reaches, see `PartnerBranchStaffAssignment`'s own docblock.
 */
export class AssignBranchStaffDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsEnum(BranchStaffRole)
  role?: BranchStaffRole;

  /** Auto-generated if omitted — see `PartnerBranchStaffService.nextDisplayCode`. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  employeeDisplayCode?: string;
}
