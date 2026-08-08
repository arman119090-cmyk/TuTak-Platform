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
 * The partner a station operator is reporting for, or null when the caller is
 * acting as an ordinary customer.
 *
 * A platform admin deliberately returns null: admins hold EV_STATION_MANAGE
 * but are not a charge point, and should not be able to write meter values
 * against arbitrary customers' sessions.
 */
export function resolveOperatorPartner(user: RequestUser): string | null {
  if (isPlatformAdmin(user)) return null;
  if (!user.permissions.includes(PermissionName.EV_STATION_MANAGE)) return null;
  return partnerIdsFor(user)[0] ?? null;
}
