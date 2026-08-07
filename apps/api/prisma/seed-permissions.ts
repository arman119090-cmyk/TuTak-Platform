import { PermissionName, RoleName } from '@prisma/client';

/**
 * Which permissions each role is granted at seed time.
 *
 * Extracted from `seed.ts` so it can be asserted against directly. The
 * integration harness deliberately grants every permission to every role —
 * those suites test money correctness, not authorization — which means a
 * test reading permissions out of the test database would learn nothing
 * about what production actually hands out. This map is the real answer.
 */
export const ROLE_PERMISSIONS: Record<RoleName, PermissionName[]> = {
  CUSTOMER: [PermissionName.WALLET_READ, PermissionName.QR_REDEEM],
  PARTNER_STAFF: [PermissionName.QR_ISSUE, PermissionName.PARTNER_TRANSACTIONS_READ],
  PARTNER_OWNER: [
    PermissionName.QR_ISSUE,
    PermissionName.PARTNER_TRANSACTIONS_READ,
    PermissionName.PARTNER_MANAGE,
    PermissionName.EV_STATION_MANAGE,
    PermissionName.ANALYTICS_READ,
  ],
  ADMIN: [
    PermissionName.USER_MANAGE,
    PermissionName.PARTNER_MANAGE,
    PermissionName.BONUS_RULE_MANAGE,
    PermissionName.ADMIN_AUDIT_READ,
    PermissionName.EV_STATION_MANAGE,
    PermissionName.ANALYTICS_READ,
    PermissionName.WALLET_WRITE,
    PermissionName.PAYMENT_REFUND,
    PermissionName.LEDGER_READ,
    // PAYOUT_MANAGE is deliberately absent. Wiring money to an external bank
    // account is the least reversible action on this platform; it stays with
    // SUPER_ADMIN until there is a maker-checker flow to hand it out safely.
  ],
  SUPER_ADMIN: Object.values(PermissionName),
};
