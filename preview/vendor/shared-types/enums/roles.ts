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

/** Fine-grained permissions, assignable to roles independent of role hierarchy. */
export enum Permission {
  WALLET_READ = 'WALLET_READ',
  WALLET_WRITE = 'WALLET_WRITE',
  BONUS_RULE_MANAGE = 'BONUS_RULE_MANAGE',
  PARTNER_MANAGE = 'PARTNER_MANAGE',
  PARTNER_TRANSACTIONS_READ = 'PARTNER_TRANSACTIONS_READ',
  USER_MANAGE = 'USER_MANAGE',
  ADMIN_AUDIT_READ = 'ADMIN_AUDIT_READ',
  EV_STATION_MANAGE = 'EV_STATION_MANAGE',
  QR_ISSUE = 'QR_ISSUE',
  QR_REDEEM = 'QR_REDEEM',
  ANALYTICS_READ = 'ANALYTICS_READ',
}
