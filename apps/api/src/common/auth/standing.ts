import { ForbiddenException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';

/** Either a transaction client or anything with the same `$queryRaw`. */
type Tx = Prisma.TransactionClient;

interface RoleRow {
  role: RoleName;
  partnerId: string | null;
  allBranches: boolean;
}

/**
 * Does this person still have standing, *at the moment the money moves*?
 *
 * Every request rebuilds its claims from the database — `buildRequestUser-
 * Claims` reads roles and active assignments on each call, so a deactivated
 * cashier is refused on their next request without waiting for a token to
 * expire. That closes the stale-session question and leaves a narrower one
 * open, which is what this function is for:
 *
 *   1. a request reads the claims and they permit the act;
 *   2. the owner deactivates the person, or ends their posting;
 *   3. the request, still running, commits the financial effect.
 *
 * The claims were true when they were read. They were false when the money
 * moved. Nothing in between re-asked.
 *
 * ## The ordering this establishes
 *
 * Called as the first statement inside the transaction that writes the
 * financial effect, under `READ COMMITTED` — which is what these statements
 * give us, and deliberately not a snapshot taken earlier:
 *
 *   * a revocation that **committed before** this check is visible to it, and
 *     the act is refused;
 *   * a revocation that has **started but not committed** holds a row lock on
 *     the very rows read here, so this check waits for it and then sees the
 *     result;
 *   * a revocation that **starts after** this check blocks on the `FOR SHARE`
 *     locks until the financial transaction commits, and takes effect
 *     afterwards.
 *
 * That last case is not a hole. An act that legitimately completed before the
 * revocation stays completed: a sale confirmed at 14:59:59 by somebody
 * dismissed at 15:00:00 happened, and promising otherwise would mean
 * promising to undo settled money.
 *
 * `FOR SHARE` rather than `FOR UPDATE`: this transaction reads those rows and
 * must not change them. Two confirmations by two cashiers must not queue
 * behind each other, and they do not — share locks are mutually compatible
 * and conflict only with a writer, which is exactly the revocation we care
 * about.
 *
 * Lock order is users → user_roles → assignment, and every revocation path
 * writes exactly one of those three tables (`deactivate` touches assignments,
 * `setAllBranches` and role removal touch user_roles, account deactivation
 * touches users), so there is no cycle to deadlock on.
 *
 * ## What it is not
 *
 * Not a replacement for the controller's check. That one refuses the request
 * outright and reports it as forbidden with nothing half-done; this one is
 * the last word before the write, and it is deliberately the same question
 * asked twice.
 */
export async function assertStandingAtFinancialChange(
  tx: Tx,
  params: { partnerId: string; branchId: string | null; userId: string },
): Promise<void> {
  const { partnerId, branchId, userId } = params;

  const [account] = await tx.$queryRaw<{ isActive: boolean; deletedAt: Date | null }[]>`
    SELECT "isActive", "deletedAt" FROM "users" WHERE "id" = ${userId} FOR SHARE
  `;
  if (!account || !account.isActive || account.deletedAt) {
    throw new ForbiddenException('This account is no longer active');
  }

  const roles = await tx.$queryRaw<RoleRow[]>`
    SELECT r."name" AS role, ur."partnerId" AS "partnerId", ur."allBranches" AS "allBranches"
    FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."roleId"
    WHERE ur."userId" = ${userId}
    FOR SHARE OF ur
  `;

  const isPlatformAdmin = roles.some(
    (r) => r.role === RoleName.ADMIN || r.role === RoleName.SUPER_ADMIN,
  );
  const here = roles.filter((r) => r.partnerId === partnerId);
  if (!isPlatformAdmin && here.length === 0) {
    throw new ForbiddenException('You are no longer authorized to act for this partner');
  }

  // Mirrors `isAllBranchOperator`: an owner, a platform admin, or an explicit
  // all-branch grant reaches every branch without being posted to one.
  const everyBranch =
    isPlatformAdmin || here.some((r) => r.role === RoleName.PARTNER_OWNER || r.allBranches);
  if (!branchId || everyBranch) return;

  const [posting] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "partner_branch_staff_assignments"
    WHERE "partnerId" = ${partnerId}
      AND "partnerBranchId" = ${branchId}
      AND "userId" = ${userId}
      AND "isActive" = true
    FOR SHARE
  `;
  if (!posting) {
    throw new ForbiddenException('You are no longer assigned to this branch');
  }
}
