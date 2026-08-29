import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { RequestUser } from '../../modules/auth/types/request-user.type';
import { hasPartnerScope, isPlatformAdmin } from './partner-scope';

/**
 * Branch-scoped authorization — the fuel-station branches task's own layer
 * on top of `partner-scope.ts`.
 *
 * `hasPartnerScope` alone answers "may this user act for this partner at
 * all". For a partner with branches, that used to be the *entire* answer —
 * a `PARTNER_STAFF`/`PARTNER_MANAGER` role scoped to partner X was, in
 * effect, access to every one of X's branches, because nothing recorded
 * which one they actually worked at. These helpers are what closes that:
 * branch-A staff must never see branch-B's queue, history, or QR.
 *
 * `PARTNER_OWNER`, a platform admin, or an explicit `UserRole.allBranches`
 * grant all see every branch of a partner they're scoped to — see
 * `isAllBranchOperator`. Everyone else is checked against
 * `RequestUser.branchIds`, populated fresh on every request from
 * `PartnerBranchStaffAssignment` (see `UsersService.buildRequestUserClaims`).
 */

/** True when the user sees every branch of `partnerId`, not just some. */
export function isAllBranchOperator(user: RequestUser, partnerId: string): boolean {
  return (
    isPlatformAdmin(user) ||
    Boolean(user.partnerScopes?.[RoleName.PARTNER_OWNER]?.includes(partnerId)) ||
    Boolean(user.allBranchPartnerIds?.includes(partnerId))
  );
}

/**
 * True when the user may act at this specific branch of this partner.
 * Always requires ordinary partner scope first — a caller with no scope for
 * the partner at all is refused here too, not just "not this branch".
 */
export function hasBranchScope(user: RequestUser, partnerId: string, branchId: string): boolean {
  if (!hasPartnerScope(user, partnerId)) return false;
  if (isAllBranchOperator(user, partnerId)) return true;
  return Boolean(user.branchIds?.includes(branchId));
}

/** Throws unless the user may act at this specific branch of this partner. */
export function assertBranchScope(user: RequestUser, partnerId: string, branchId: string): void {
  if (!hasBranchScope(user, partnerId, branchId)) {
    throw new ForbiddenException('You are not authorized to act at this branch');
  }
}

/**
 * The combined partner+branch check a branch-nullable resource (chiefly
 * `PurchaseIntent`) needs at every read/write endpoint: `branchId` null
 * means the resource predates branch scoping, or belongs to a partner with
 * no branches at all, so only the ordinary partner check applies (unchanged
 * behavior for every partner this task does not touch); non-null means a
 * specific branch was involved, and access is refused unless the caller is
 * scoped to that branch specifically.
 */
export function assertResourceBranchScope(
  user: RequestUser,
  partnerId: string,
  branchId: string | null | undefined,
): void {
  if (!hasPartnerScope(user, partnerId)) {
    throw new ForbiddenException('You are not authorized to act for this partner');
  }
  if (branchId) {
    assertBranchScope(user, partnerId, branchId);
  }
}

/**
 * Which branches of `partnerId` a list/aggregate endpoint should restrict
 * itself to for this caller.
 *
 * `null` means no restriction — an owner, admin, or all-branch operator
 * sees every branch (and every legacy, branch-less row) exactly as before
 * this task shipped. A non-null array is the caller's actual assignment
 * list, which may be *empty* — a `PARTNER_STAFF`/`PARTNER_MANAGER` with no
 * active branch assignment is deliberately unassigned, and an empty
 * `{ in: [] }` filter is exactly the "show nothing" behavior that state
 * requires, rather than an unfiltered list defaulting open.
 */
export function branchFilterFor(user: RequestUser, partnerId: string): string[] | null {
  if (isAllBranchOperator(user, partnerId)) return null;
  return user.branchIds ?? [];
}
