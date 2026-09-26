import { SetMetadata } from '@nestjs/common';
import { PermissionName } from '@prisma/client';

export const PERMISSIONS_KEY = 'permissions';

/** Restricts a route to users holding all of the given fine-grained permissions. */
export const RequirePermissions = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';

/**
 * Restricts a route to users holding *at least one* of the given
 * permissions — for a capability several permission sets need, e.g. managing
 * one's own shift, which every cash-desk permission requires (item 10 of the
 * Partner Commerce final fixes: availability follows permissions, not a
 * primary role name).
 */
export const RequireAnyPermission = (...permissions: PermissionName[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
