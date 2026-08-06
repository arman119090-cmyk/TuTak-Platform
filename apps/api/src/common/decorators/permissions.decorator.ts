import { SetMetadata } from '@nestjs/common';
import { PermissionName } from '@prisma/client';

export const PERMISSIONS_KEY = 'permissions';

/** Restricts a route to users holding all of the given fine-grained permissions. */
export const RequirePermissions = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
