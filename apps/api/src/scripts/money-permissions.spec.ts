import { PermissionName, RoleName } from '@prisma/client';
import { ROLE_PERMISSIONS } from './role-permissions';

/**
 * Who is allowed to move money, as a property of the seeded role map rather
 * than of whichever controller somebody read last.
 *
 * Unit tests on purpose. The integration harness deliberately grants every
 * permission to every role — those suites test money correctness, not
 * authorisation — so a test reading permissions out of the test database
 * would learn nothing about what production hands out. `ROLE_PERMISSIONS` is
 * the real answer, and this is where it is held to account.
 */
describe('money permissions', () => {
  const holdersOf = (permission: PermissionName): RoleName[] =>
    (Object.keys(ROLE_PERMISSIONS) as RoleName[]).filter((role) =>
      ROLE_PERMISSIONS[role].includes(permission),
    );

  it('never lets one role hold both halves of a two-person act, except SUPER_ADMIN', () => {
    // Terms are proposed by one person and approved by another. If a single
    // role held both grants, the maker/checker rule would rest entirely on
    // comparing two user ids at the last moment — and a rule this expensive
    // to get wrong should be arranged by role as well.
    const bothHalves = (Object.keys(ROLE_PERMISSIONS) as RoleName[]).filter(
      (role) =>
        ROLE_PERMISSIONS[role].includes(PermissionName.CONTRIBUTION_RULE_PROPOSE) &&
        ROLE_PERMISSIONS[role].includes(PermissionName.CONTRIBUTION_RULE_APPROVE),
    );
    // SUPER_ADMIN holds everything by construction. An organisation that
    // wants one person to do both gives them that, and it is on the record.
    expect(bothHalves).toEqual([RoleName.SUPER_ADMIN]);
  });

  it('keeps sending money out and recording money in as separate keys', () => {
    // Whoever can wire funds away should not also be able to assert that
    // funds appeared: an asserted inbound settlement is cash conjured from a
    // form field.
    expect(holdersOf(PermissionName.PAYOUT_MANAGE)).toEqual([RoleName.SUPER_ADMIN]);
    expect(holdersOf(PermissionName.ACQUIRER_SETTLEMENT_MANAGE)).toEqual([RoleName.SUPER_ADMIN]);
  });

  it.each([
    PermissionName.PSP_RECONCILE,
    PermissionName.SETTLEMENT_MANAGE,
    PermissionName.CONTRIBUTION_RULE_PROPOSE,
    PermissionName.CONTRIBUTION_RULE_APPROVE,
    PermissionName.ACQUIRER_SETTLEMENT_MANAGE,
    PermissionName.TREASURY_READ,
  ])('never gives a partner-side role %s', (permission) => {
    const partnerRoles: RoleName[] = [
      RoleName.PARTNER_STAFF,
      RoleName.PARTNER_MANAGER,
      RoleName.PARTNER_OWNER,
    ];
    for (const role of partnerRoles) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(permission);
    }
  });

  it('gives a partner owner read access to their own settlements and nothing more', () => {
    // A partner disputing a figure needs the itemisation. What they must not
    // have is any way to move their own Net Position — they are the payee.
    expect(ROLE_PERMISSIONS[RoleName.PARTNER_OWNER]).toContain(PermissionName.SETTLEMENT_READ);
    expect(ROLE_PERMISSIONS[RoleName.PARTNER_OWNER]).not.toContain(
      PermissionName.SETTLEMENT_MANAGE,
    );
  });

  /*
   * The owner's decision of 22.09.2026, written down so it cannot drift:
   * SETTLEMENT_READ belongs to the owner and to nobody else on the partner
   * side. A manager runs the shift; what the business is owed is the
   * owner's to see. Nothing above pinned this — the shared list covers
   * SETTLEMENT_MANAGE and the rate permissions, not this read — so a later
   * edit could have granted it without a single test noticing.
   */
  it.each([RoleName.PARTNER_MANAGER, RoleName.PARTNER_STAFF])(
    'keeps the settlements read away from %s',
    (role) => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(PermissionName.SETTLEMENT_READ);
    },
  );

  it('never gives a cashier anything beyond confirming a purchase', () => {
    const cashier = ROLE_PERMISSIONS[RoleName.PARTNER_STAFF];
    expect(cashier).toContain(PermissionName.PURCHASE_INTENT_CONFIRM);
    for (const permission of [
      PermissionName.PSP_RECONCILE,
      PermissionName.SETTLEMENT_MANAGE,
      PermissionName.PAYMENT_REFUND,
      PermissionName.PARTNER_MANAGE,
    ]) {
      expect(cashier).not.toContain(permission);
    }
  });

  it('accounts for every permission the schema defines', () => {
    // A permission nobody holds is a route nobody can reach, which is a
    // deployment bug that looks like a security feature. SUPER_ADMIN holds
    // the full set, so this is really a check that the enum and the map have
    // not drifted apart.
    expect([...ROLE_PERMISSIONS[RoleName.SUPER_ADMIN]].sort()).toEqual(
      [...Object.values(PermissionName)].sort(),
    );
  });
});
