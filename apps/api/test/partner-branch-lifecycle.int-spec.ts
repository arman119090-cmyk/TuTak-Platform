import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PartnerBranchState, PrismaClient, PurchaseIntentStatus, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PartnersService } from '../src/modules/partners/partners.service';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PurchaseIntentRefundRequestService } from '../src/modules/purchase-intents/purchase-intent-refund-request.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Opening a location, shutting it for a while, and closing it for good.
 *
 * `isActive` answered the first and the third the same way, which is how a
 * refurbishment and a closure ended up looking identical on the owner's
 * screen. The state column separates them, and the rules that matter are the
 * ones about what *keeps* working: a location closing is not a reason to
 * strand the customer who bought something there last week, so returns,
 * disputes and history go on exactly as before.
 */
describe('Partner branch lifecycle (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnersController;
  let partners: PartnersService;
  let branchStaff: PartnerBranchStaffService;
  let intents: PurchaseIntentsService;
  let refundRequests: PurchaseIntentRefundRequestService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnersController);
    partners = harness.app.get(PartnersService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
    intents = harness.app.get(PurchaseIntentsService);
    refundRequests = harness.app.get(PurchaseIntentRefundRequestService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const actor = (id: string, roles: RoleName[], partnerId: string): RequestUser => ({
    id,
    phone: '+37400000000',
    roles,
    permissions: [],
    partnerScopes: Object.fromEntries(roles.map((r) => [r, [partnerId]])),
    branchIds: [],
    allBranchPartnerIds: roles.includes(RoleName.PARTNER_OWNER) ? [partnerId] : [],
    mustChangePassword: false,
  });

  const branchOf = (partnerId: string, name: string) =>
    prisma.partnerBranch.create({
      data: {
        partnerId,
        name,
        address: `${name} 1`,
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      },
    });

  const hire = async (partnerId: string, role: RoleName = RoleName.PARTNER_STAFF) => {
    const staff = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: staff.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: role } })).id,
        partnerId,
      },
    });
    return staff;
  };

  describe('the three states', () => {
    it('starts a new branch open', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');

      expect(branch.state).toBe(PartnerBranchState.ACTIVE);
      expect(branch.isActive).toBe(true);
      // Nothing happened to it, so there is no date on which something did.
      expect(branch.stateChangedAt).toBeNull();
    });

    it.each([
      [PartnerBranchState.SUSPENDED, false],
      [PartnerBranchState.ARCHIVED, false],
      [PartnerBranchState.ACTIVE, true],
    ])('keeps isActive in step with %s', async (state, expected) => {
      const partner = await createPartner(prisma);
      const owner = await hire(partner.id, RoleName.PARTNER_OWNER);
      const branch = await branchOf(partner.id, 'North');

      const updated = await controller.setBranchState(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
        branch.id,
        { state },
      );

      expect(updated.state).toBe(state);
      expect(updated.isActive).toBe(expected);
      expect(updated.stateChangedByUserId).toBe(owner.id);
    });

    /**
     * The two columns are one fact written twice, and the database keeps
     * them that way rather than trusting every writer to remember.
     *
     * A statement naming only `state` is saying which kind of closure it
     * means, so the boolean follows it — an archived branch cannot end up
     * still trading, which is the whole point of archiving.
     */
    it('makes the boolean follow a statement that names only the state', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');

      await prisma.$executeRaw`
        UPDATE "partner_branches" SET "state" = 'ARCHIVED' WHERE "id" = ${branch.id}
      `;

      const after = await prisma.partnerBranch.findUniqueOrThrow({ where: { id: branch.id } });
      expect(after.state).toBe(PartnerBranchState.ARCHIVED);
      expect(after.isActive).toBe(false);
    });

    /**
     * The previous release, mid-deploy: it flips the boolean and knows
     * nothing about `state`. It must keep working, and "off" in its
     * vocabulary has always meant the reversible closure — so it suspends,
     * and never archives by accident.
     */
    it('makes the state follow a writer that only knows the old boolean', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');

      await prisma.$executeRaw`
        UPDATE "partner_branches" SET "isActive" = false WHERE "id" = ${branch.id}
      `;

      const shut = await prisma.partnerBranch.findUniqueOrThrow({ where: { id: branch.id } });
      expect(shut.state).toBe(PartnerBranchState.SUSPENDED);

      await prisma.$executeRaw`
        UPDATE "partner_branches" SET "isActive" = true WHERE "id" = ${branch.id}
      `;
      const reopened = await prisma.partnerBranch.findUniqueOrThrow({ where: { id: branch.id } });
      expect(reopened.state).toBe(PartnerBranchState.ACTIVE);
    });

    /**
     * What the trigger cannot fix, and must not guess at: a writer that sets
     * both columns and contradicts itself. That is the backstop the check
     * constraint remains for.
     */
    it('still refuses a row that says both things at once', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');
      // Shut first, so that setting `isActive` back to true below is a real
      // change. A trigger sees changed values, not intent: `SET isActive =
      // true` on a branch that is already open is indistinguishable from not
      // mentioning the column, and the trigger fills it in rather than
      // treating it as a contradiction.
      await partners.setBranchState(partner.id, branch.id, PartnerBranchState.SUSPENDED);

      await expect(
        prisma.$executeRaw`
          UPDATE "partner_branches"
          SET "state" = 'ARCHIVED', "isActive" = true
          WHERE "id" = ${branch.id}
        `,
      ).rejects.toThrow(/partner_branches_state_matches_is_active/);
    });

    it('creates a shut branch consistently even when told only the boolean', async () => {
      const partner = await createPartner(prisma);

      const created = await prisma.partnerBranch.create({
        data: {
          partnerId: partner.id,
          name: 'Closed on arrival',
          address: 'Somewhere 1',
          city: 'Yerevan',
          latitude: 40.18,
          longitude: 44.51,
          isActive: false,
        },
      });

      expect(created.state).toBe(PartnerBranchState.SUSPENDED);
    });

    it('refuses to reopen an archived branch with the old boolean', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');
      await partners.setBranchState(partner.id, branch.id, PartnerBranchState.ARCHIVED);

      await expect(partners.setBranchActive(partner.id, branch.id, true)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('treats the old boolean’s "off" as a suspension, which can be undone', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');

      const shut = await partners.setBranchActive(partner.id, branch.id, false);
      expect(shut.state).toBe(PartnerBranchState.SUSPENDED);

      const reopened = await partners.setBranchActive(partner.id, branch.id, true);
      expect(reopened.state).toBe(PartnerBranchState.ACTIVE);
    });

    it('is the owner’s decision, not a cashier’s', async () => {
      const partner = await createPartner(prisma);
      const cashier = await hire(partner.id);
      const branch = await branchOf(partner.id, 'North');

      await expect(
        controller.setBranchState(
          actor(cashier.id, [RoleName.PARTNER_STAFF], partner.id),
          partner.id,
          branch.id,
          { state: PartnerBranchState.ARCHIVED },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('what a shut branch stops', () => {
    it.each([PartnerBranchState.SUSPENDED, PartnerBranchState.ARCHIVED])(
      'refuses a new purchase at a %s branch',
      async (state) => {
        const partner = await createPartner(prisma);
        const customer = await createCustomer(prisma);
        const branch = await branchOf(partner.id, 'North');
        await partners.setBranchState(partner.id, branch.id, state);

        await expect(
          intents.create(
            { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
            customer.user.id,
          ),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('refuses to post new staff to an archived branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await hire(partner.id, RoleName.PARTNER_OWNER);
      const staff = await hire(partner.id);
      const branch = await branchOf(partner.id, 'North');
      await partners.setBranchState(partner.id, branch.id, PartnerBranchState.ARCHIVED);

      await expect(
        branchStaff.assign(partner.id, branch.id, {
          userId: staff.id,
          assignedByUserId: owner.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('still posts staff to a suspended branch, which reopens', async () => {
      const partner = await createPartner(prisma);
      const owner = await hire(partner.id, RoleName.PARTNER_OWNER);
      const staff = await hire(partner.id);
      const branch = await branchOf(partner.id, 'North');
      await partners.setBranchState(partner.id, branch.id, PartnerBranchState.SUSPENDED);

      const posting = await branchStaff.assign(partner.id, branch.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });

      expect(posting.partnerBranchId).toBe(branch.id);
    });

    it('drops an archived branch out of the ordinary list but keeps it findable', async () => {
      const partner = await createPartner(prisma);
      const open = await branchOf(partner.id, 'North');
      const gone = await branchOf(partner.id, 'South');
      await partners.setBranchState(partner.id, gone.id, PartnerBranchState.ARCHIVED);

      const ordinary = await partners.listBranches(partner.id);
      const everything = await partners.listBranches(partner.id, true);

      expect(ordinary.map((b) => b.id)).toEqual([open.id]);
      expect(everything.map((b) => b.id)).toEqual([open.id, gone.id]);
    });
  });

  describe('what a shut branch does not stop', () => {
    /**
     * The point of the whole design. A customer who bought something on
     * Friday at a shop that closed on Monday still has a purchase, and the
     * people entitled to settle it still are.
     */
    it('leaves a purchase made before the closure exactly where it was', async () => {
      const partner = await createPartner(prisma);
      const owner = await hire(partner.id, RoleName.PARTNER_OWNER);
      const cashier = await hire(partner.id);
      const customer = await createCustomer(prisma);
      const branch = await branchOf(partner.id, 'North');
      await branchStaff.assign(partner.id, branch.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });

      const intent = await intents.create(
        { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
        customer.user.id,
      );
      await intents.confirm(intent.id, cashier.id);
      await partners.setBranchState(partner.id, branch.id, PartnerBranchState.ARCHIVED);

      const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(after.status).toBe(PurchaseIntentStatus.CONFIRMED);
      expect(after.partnerBranchId).toBe(branch.id);
    });

    it('lets a return be raised against a purchase at an archived branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await hire(partner.id, RoleName.PARTNER_OWNER);
      const cashier = await hire(partner.id);
      const customer = await createCustomer(prisma);
      const branch = await branchOf(partner.id, 'North');
      await branchStaff.assign(partner.id, branch.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      const intent = await intents.create(
        { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
        customer.user.id,
      );
      await intents.confirm(intent.id, cashier.id);

      await partners.setBranchState(partner.id, branch.id, PartnerBranchState.ARCHIVED);

      const request = await refundRequests.request({
        purchaseIntentId: intent.id,
        amount: '1000',
        reason: 'Customer brought it back after we closed the shop',
        requestedByUserId: cashier.id,
      });

      expect(request.purchaseIntentId).toBe(intent.id);
      expect(request.partnerBranchId).toBe(branch.id);
    });

    it('keeps the branch resolvable on the row it belongs to', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');
      await partners.setBranchState(partner.id, branch.id, PartnerBranchState.ARCHIVED);

      const found = await prisma.partnerBranch.findUniqueOrThrow({ where: { id: branch.id } });
      expect(found.name).toBe('North');
    });
  });
});
