import { ForbiddenException } from '@nestjs/common';
import { PermissionName, PrismaClient, RoleName } from '@prisma/client';
import { PartnerSettlementPartnerController } from '../src/modules/partner-settlements/partner-settlement.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createPartner, createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Who inside a partner may read that partner's money.
 *
 * `ROLE_PERMISSIONS` answers this already, and answers it deliberately:
 * `SETTLEMENT_READ` is granted to `PARTNER_OWNER` and to no other partner
 * role, with a docblock saying why. A cashier confirms sales; what the
 * organisation is owed, what it owes, and the itemisation behind both are
 * the owner's business.
 *
 * The routes did not enforce it. `PartnerSettlementPartnerController` called
 * `assertPartnerScope` and stopped there, and scope only asks *which*
 * partner — every `PARTNER_STAFF` row is scoped to their own partner, so
 * every cashier passed. The permission existed, the role map was right, and
 * the door was open anyway.
 *
 * Two halves are asserted here, because either alone can pass while the
 * other is broken: the route demands the permission (read off the
 * decorator's metadata, the idiom `financial-authorization.int-spec.ts`
 * uses), and the scope check still refuses another partner's id.
 */
describe('Partner settlement access (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnerSettlementPartnerController;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnerSettlementPartnerController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const actor = (
    id: string,
    roles: RoleName[],
    partnerScopes: Record<string, string[]> = {},
  ): RequestUser => ({
    id,
    phone: '+37400000000',
    roles,
    permissions: [],
    partnerScopes,
    mustChangePassword: false,
  });

  /** The permission a route demands, read off the decorator's metadata. */
  const permissionsOn = (method: string): PermissionName[] =>
    (Reflect.getMetadata(
      'permissions',
      (controller as unknown as Record<string, unknown>)[method] as object,
    ) as PermissionName[]) ?? [];

  describe('the permission every partner-facing money read demands', () => {
    it.each(['statements', 'statement', 'position'])(
      '`%s` is gated on SETTLEMENT_READ, which only the owner holds',
      (method) => {
        expect(permissionsOn(method)).toContain(PermissionName.SETTLEMENT_READ);
      },
    );

    /**
     * Reporting a missing transfer is behind the same gate, since
     * 22.09.2026.
     *
     * The previous reading was that a cashier told the transfer never
     * arrived should be able to say so. Two things were wrong with it. A
     * cashier cannot know: they cannot see the settlement, its amount or
     * its id, and the only screen that shows them is gated on this
     * permission. And filing a report used to move the settlement to
     * `REQUIRES_RECONCILIATION` — so an ungated route handed anybody on the
     * payroll a way to park their employer's payouts in a state only two
     * people at TuTak can lift.
     *
     * Both halves are now closed: the report changes no status, and only
     * somebody who can see the settlement may file one. This is a
     * narrowing — a manager could file one before and cannot now — so it
     * widens nobody's financial access.
     */
    it('gates reporting a problem on the same permission as the reads', () => {
      expect(permissionsOn('reportProblem')).toContain(PermissionName.SETTLEMENT_READ);
    });
  });

  describe('scope, which the permission does not replace', () => {
    it('refuses an owner reading another partner’s position', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const theirs = await createPartner(prisma, { displayName: 'Theirs' });
      const { user } = await createCustomer(prisma);

      await expect(
        controller.position(
          actor(user.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [mine.id] }),
          theirs.id,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets an owner read their own position', async () => {
      const partner = await createPartner(prisma);
      const { user } = await createCustomer(prisma);

      const position = await controller.position(
        actor(user.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [partner.id] }),
        partner.id,
      );

      // Nothing has happened to this partner, and "nothing" is zero rather
      // than an error — the screen has a third state for exactly this.
      expect(position.ledgerBalance.toString()).toBe('0');
    });
  });
});
