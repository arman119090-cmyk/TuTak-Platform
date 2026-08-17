import { ForbiddenException } from '@nestjs/common';
import { PermissionName, RoleName } from '@prisma/client';
import { RequestUser } from '../../modules/auth/types/request-user.type';

/**
 * Partner-scoped authorization.
 *
 * `RequestUser.partnerScopes` has always carried which partners a user's roles
 * are scoped to, but nothing consulted it: `RolesGuard` and `PermissionsGuard`
 * check only that a permission is held, not which partner it is held *for*.
 * So a PARTNER_OWNER holding EV_STATION_MANAGE could create stations, set
 * prices and read data under any other partner's id — docs/AUDIT_2026-08-B.md
 * §H5.
 *
 * These helpers are the missing half of that check. They are deliberately
 * plain functions rather than a guard: the partner id lives in a different
 * place on every route (body, path, or a row that has to be loaded first), so
 * the call site is the only place that knows what to check.
 */

const ADMIN_ROLES: RoleName[] = [RoleName.ADMIN, RoleName.SUPER_ADMIN];

export const isPlatformAdmin = (user: RequestUser): boolean =>
  user.roles.some((role) => ADMIN_ROLES.includes(role));

/** Every partner this user holds any scoped role for. */
export function partnerIdsFor(user: RequestUser): string[] {
  return Array.from(new Set(Object.values(user.partnerScopes ?? {}).flat()));
}

/** True when the user is scoped to this partner, or is a platform admin. */
export function hasPartnerScope(user: RequestUser, partnerId: string): boolean {
  return isPlatformAdmin(user) || partnerIdsFor(user).includes(partnerId);
}

/** Throws unless the user may act on behalf of the given partner. */
export function assertPartnerScope(user: RequestUser, partnerId: string): void {
  if (!hasPartnerScope(user, partnerId)) {
    throw new ForbiddenException('You are not authorized to act for this partner');
  }
}

/**
 * Throws unless the user administers the platform itself.
 *
 * For operations that are not *about* one partner but about the set of them:
 * bringing a new tenant into existence, or switching one off. There is no
 * partner id to scope such an action against, so `assertPartnerScope` cannot
 * express it and the check has to be the role.
 *
 * This exists because `@RequirePermissions(PARTNER_MANAGE)` reads like it
 * means "platform administrator" and does not. PARTNER_OWNER holds that
 * permission — owners manage their own partner — so every route gated on the
 * permission alone was open to every tenant on the network.
 */
export function assertPlatformAdmin(user: RequestUser, action: string): void {
  if (!isPlatformAdmin(user)) {
    throw new ForbiddenException(`${action} is restricted to platform administrators`);
  }
}

/**
 * Roles that grant `EV_STATION_MANAGE` — kept in sync with
 * `scripts/role-permissions.ts` (ADMIN/SUPER_ADMIN also grant it, but both
 * are platform-admin roles already handled by the `isPlatformAdmin` check
 * below, not partner-scoped roles this function needs to consider).
 */
const EV_OPERATOR_ROLES: RoleName[] = [RoleName.PARTNER_MANAGER, RoleName.PARTNER_OWNER];

/**
 * The partner a station operator is reporting for, or null when the caller is
 * acting as an ordinary customer.
 *
 * A platform admin deliberately returns null: admins hold EV_STATION_MANAGE
 * but are not a charge point, and should not be able to write meter values
 * against arbitrary customers' sessions.
 *
 * Deliberately does *not* use `partnerIdsFor(user)`: that flattens every
 * partner the caller holds *any* scoped role at, regardless of whether that
 * role is one of the ones that actually grants `EV_STATION_MANAGE`. A user
 * who is legitimately `PARTNER_STAFF` at one partner (no EV permission) and
 * self-applies as `PARTNER_OWNER` of an unrelated, freshly self-created
 * partner (`POST /partners/apply` needs no admin approval to grant that
 * role) would otherwise get attributed to the *first* partner id, which can
 * be the STAFF one — letting them report fabricated meter values against a
 * real partner's live sessions despite holding no EV-managing role there
 * (independent audit, GitHub issue #28). Only partners scoped via a role in
 * `EV_OPERATOR_ROLES` are ever considered.
 */
export function resolveOperatorPartner(user: RequestUser): string | null {
  if (isPlatformAdmin(user)) return null;
  if (!user.permissions.includes(PermissionName.EV_STATION_MANAGE)) return null;
  const scopes = user.partnerScopes ?? {};
  const operatorPartnerIds = Array.from(
    new Set(EV_OPERATOR_ROLES.flatMap((role) => scopes[role] ?? [])),
  );
  return operatorPartnerIds[0] ?? null;
}
