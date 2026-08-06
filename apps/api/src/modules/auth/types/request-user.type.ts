import { PermissionName, RoleName } from '@prisma/client';

/** Shape of `request.user` after JwtStrategy.validate() runs. */
export interface RequestUser {
  id: string;
  phone: string;
  roles: RoleName[];
  permissions: PermissionName[];
  /** partnerId per scoped role, e.g. { PARTNER_OWNER: ['partner-uuid'] } */
  partnerScopes: Record<string, string[]>;
  deviceId?: string;
}
