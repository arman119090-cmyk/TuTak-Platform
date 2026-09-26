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
  // The cashier tier — spec: docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md §3.
  // Confirms/rejects PurchaseIntents as ordinary work; no PARTNER_MANAGE, so
  // no route to the negotiated rate or the bonus-payment cap.
  PARTNER_STAFF: [
    PermissionName.QR_ISSUE,
    PermissionName.PARTNER_TRANSACTIONS_READ,
    PermissionName.PURCHASE_INTENT_CONFIRM,
    PermissionName.PARTNER_ORDER_MANAGE,
  ],
  // The manager tier: broader day-to-day operational reach than STAFF, but
  // — like STAFF — still no PARTNER_MANAGE. "Operational access appropriate
  // to scope, but no unrestricted access to critical contractual/banking
  // configuration" is the spec's own phrase for this tier.
  PARTNER_MANAGER: [
    PermissionName.QR_ISSUE,
    PermissionName.PARTNER_TRANSACTIONS_READ,
    PermissionName.PURCHASE_INTENT_CONFIRM,
    PermissionName.PARTNER_ORDER_MANAGE,
    PermissionName.EV_STATION_MANAGE,
    PermissionName.ANALYTICS_READ,
  ],
  PARTNER_OWNER: [
    PermissionName.QR_ISSUE,
    PermissionName.PARTNER_TRANSACTIONS_READ,
    PermissionName.PURCHASE_INTENT_CONFIRM,
    PermissionName.PARTNER_ORDER_MANAGE,
    PermissionName.PARTNER_MANAGE,
    PermissionName.EV_STATION_MANAGE,
    PermissionName.ANALYTICS_READ,
    // Reads their own statements, itemised to the purchase that produced
    // each line — a partner disputing a figure needs to be able to check it.
    // The partner-facing routes scope every read to their own partner id on
    // top of this; the permission alone grants nothing cross-partner.
    //
    // `SETTLEMENT_MANAGE` is deliberately absent, and so is
    // `CONTRIBUTION_RULE_APPROVE`: a payee who can move their own Net
    // Position is not a payee, and a counterparty who can approve their own
    // rate sets it.
    PermissionName.SETTLEMENT_READ,
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
    // Partner Commerce operators: queues, sourcing, escalations, manual
    // review — and deciding disputes, a financial decision (spec §29).
    PermissionName.PARTNER_ORDER_OPERATE,
    PermissionName.ORDER_DISPUTE_RESOLVE,
    // The finance desk's day job: watching payments that did not resolve,
    // reading settlements, and proposing terms.
    PermissionName.PSP_READ,
    PermissionName.PSP_RECONCILE,
    PermissionName.SETTLEMENT_READ,
    PermissionName.SETTLEMENT_MANAGE,
    PermissionName.CONTRIBUTION_RULE_PROPOSE,
    PermissionName.TREASURY_READ,
    // PAYOUT_MANAGE is deliberately absent. Wiring money to an external bank
    // account is the least reversible action on this platform; it stays with
    // SUPER_ADMIN until there is a maker-checker flow to hand it out safely.
    //
    // `CONTRIBUTION_RULE_APPROVE` and `ACQUIRER_SETTLEMENT_MANAGE` are
    // absent for a related but distinct reason: both are the *second* half
    // of a two-person act. Granting an ADMIN both halves would leave the
    // maker/checker rule resting entirely on comparing two user ids, and a
    // rule that expensive to get wrong should be arranged by role as well.
    // An organisation that wants one person to do both gives them
    // SUPER_ADMIN and accepts that on the record.
  ],
  SUPER_ADMIN: Object.values(PermissionName),
};
