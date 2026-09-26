/**
 * Platform-wide role identifiers. Backs RBAC guards in the API and
 * navigation/feature gating in the clients.
 */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  PARTNER_STAFF = 'PARTNER_STAFF',
  PARTNER_OWNER = 'PARTNER_OWNER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}
