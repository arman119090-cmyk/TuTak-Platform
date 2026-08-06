import { SetMetadata } from '@nestjs/common';
import { RoleName } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restricts a route to users holding at least one of the given roles. */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
