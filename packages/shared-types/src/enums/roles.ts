/**
 * Platform-wide role identifiers. Backs RBAC guards in the API and
 * navigation/feature gating in the clients.
 */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  PARTNER_STAFF = 'PARTNER_STAFF',
  /**
   * The tier between staff and owner — broader day-to-day operational
   * access, but no route to commercial configuration (see `RoleName` in
   * `apps/api/prisma/schema.prisma`). It existed on the API and was simply
   * missing here, so no client could name a role the server hands out and
   * checks; the refund queue, where a manager is one of the two people
   * allowed to decide, is where that finally bit.
   */
  PARTNER_MANAGER = 'PARTNER_MANAGER',
  PARTNER_OWNER = 'PARTNER_OWNER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}
