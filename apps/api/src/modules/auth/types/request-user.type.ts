import { PermissionName, RoleName } from '@prisma/client';

/** Shape of `request.user` after JwtStrategy.validate() runs. */
export interface RequestUser {
  id: string;
  phone: string;
  roles: RoleName[];
  permissions: PermissionName[];
  /** partnerId per scoped role, e.g. { PARTNER_OWNER: ['partner-uuid'] } */
  partnerScopes: Record<string, string[]>;
  /**
   * Fuel-station branches task: every `PartnerBranch.id` this user is
   * currently, actively assigned to via `PartnerBranchStaffAssignment` —
   * recomputed on every request, same as `partnerScopes`, so a deactivated
   * assignment stops granting access the moment it is deactivated, not at
   * next login. See `common/auth/branch-scope.ts`.
   *
   * Optional (rather than always-present-but-possibly-empty) so the many
   * hand-built `RequestUser` fixtures across the test suite that predate
   * branch scoping keep compiling unchanged — `branch-scope.ts` treats a
   * missing array exactly like an empty one.
   */
  branchIds?: string[];
  /**
   * Partner ids this user may act across *every* branch of, despite not
   * being `PARTNER_OWNER` — an explicit `UserRole.allBranches` grant.
   * Optional for the same reason as `branchIds` above.
   */
  allBranchPartnerIds?: string[];
  /** True while a bootstrap or operator-issued credential is still in place. */
  mustChangePassword: boolean;
  deviceId?: string;
}
