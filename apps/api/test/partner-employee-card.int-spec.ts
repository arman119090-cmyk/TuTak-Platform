import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient, RoleName } from '@prisma/client';
import { PartnerEmployeeController } from '../src/modules/partners/partner-employee.controller';
import { PartnerEmployeeService } from '../src/modules/partners/partner-employee.service';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Turning `EMP-007` on a receipt back into a person — and the line that has
 * to hold while doing it.
 *
 * `listForPartner` was narrowed once already because a cashier posted to one
 * branch could read another branch's roster: names, phone numbers, codes. A
 * lookup from a code to a name is the same disclosure in a form that is
 * easier to enumerate, so it is narrowed the same way, with one addition
 * that gives away nothing new: a person who confirmed a purchase at a branch
 * the caller can see is resolvable, because the caller is already looking at
 * that purchase with that code on it. Without it the owner — who confirms
 * without being posted anywhere — would be the one person a cashier could
 * never resolve.
 */
describe('Partner employee card (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnerEmployeeController;
  let employees: PartnerEmployeeService;
  let branchStaff: PartnerBranchStaffService;
  let intents: PurchaseIntentsService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnerEmployeeController);
    employees = harness.app.get(PartnerEmployeeService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
    intents = harness.app.get(PurchaseIntentsService);
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
    partnerScopes: Record<string, string[]>,
    branchIds: string[] = [],
    allBranchPartnerIds: string[] = [],
  ): RequestUser => ({
    id,
    phone: '+37400000000',
    roles,
    permissions: [],
    partnerScopes,
    branchIds,
    allBranchPartnerIds,
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

  /** A member of staff with the partner-scoped role an assignment needs. */
  const hireStaff = async (partnerId: string, role: RoleName = RoleName.PARTNER_STAFF) => {
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

  describe('an owner, who sees the whole organisation', () => {
    it('resolves a code to a person and their postings', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const staff = await hireStaff(partner.id);
      const north = await branchOf(partner.id, 'North');
      await branchStaff.assign(partner.id, north.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });
      const code = await employees.codeFor(partner.id, staff.id);

      const card = await controller.byCode(
        actor(owner.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [partner.id] }),
        partner.id,
        code,
      );

      expect(card.code).toBe(code);
      expect(card.firstName).toBe(staff.firstName);
      expect(card.assignments).toHaveLength(1);
      expect(card.assignments[0]).toMatchObject({ branchName: 'North', isActive: true });
    });

    it('shows a transfer as two postings, the old one closed', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const staff = await hireStaff(partner.id);
      const north = await branchOf(partner.id, 'North');
      const south = await branchOf(partner.id, 'South');
      const posting = await branchStaff.assign(partner.id, north.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, south.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });
      await prisma.partnerBranchStaffAssignment.update({
        where: { id: posting.id },
        data: { isActive: false, deactivatedAt: new Date() },
      });
      const code = await employees.codeFor(partner.id, staff.id);

      const card = await controller.byCode(
        actor(owner.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [partner.id] }),
        partner.id,
        code,
      );

      expect(card.assignments).toHaveLength(2);
      const closed = card.assignments.find((a) => !a.isActive);
      // "No longer here" without a date answers a different question than
      // the one somebody reading last quarter's receipt is asking.
      expect(closed?.deactivatedAt).not.toBeNull();
    });

    it('refuses another partner’s organisation outright', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const theirs = await createPartner(prisma, { displayName: 'Theirs' });
      const owner = await createStaffUser(prisma);
      const staff = await hireStaff(theirs.id);
      const code = await employees.codeFor(theirs.id, staff.id);

      await expect(
        controller.byCode(
          actor(owner.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [mine.id] }),
          theirs.id,
          code,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('a cashier, who sees one branch', () => {
    it('resolves a colleague posted to the same branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const [cashier, colleague] = [await hireStaff(partner.id), await hireStaff(partner.id)];
      const north = await branchOf(partner.id, 'North');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, north.id, {
        userId: colleague.id,
        assignedByUserId: owner.id,
      });
      const code = await employees.codeFor(partner.id, colleague.id);

      const card = await controller.byCode(
        actor(cashier.id, [RoleName.PARTNER_STAFF], { PARTNER_STAFF: [partner.id] }, [north.id]),
        partner.id,
        code,
      );

      expect(card.firstName).toBe(colleague.firstName);
    });

    it('cannot turn another branch’s code into a name', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const [cashier, stranger] = [await hireStaff(partner.id), await hireStaff(partner.id)];
      const north = await branchOf(partner.id, 'North');
      const south = await branchOf(partner.id, 'South');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, south.id, {
        userId: stranger.id,
        assignedByUserId: owner.id,
      });
      const code = await employees.codeFor(partner.id, stranger.id);

      await expect(
        controller.byCode(
          actor(cashier.id, [RoleName.PARTNER_STAFF], { PARTNER_STAFF: [partner.id] }, [north.id]),
          partner.id,
          code,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('sees only the postings at its own branch for somebody working two', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const [cashier, colleague] = [await hireStaff(partner.id), await hireStaff(partner.id)];
      const north = await branchOf(partner.id, 'North');
      const south = await branchOf(partner.id, 'South');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, north.id, {
        userId: colleague.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, south.id, {
        userId: colleague.id,
        assignedByUserId: owner.id,
      });
      const code = await employees.codeFor(partner.id, colleague.id);

      const card = await controller.byCode(
        actor(cashier.id, [RoleName.PARTNER_STAFF], { PARTNER_STAFF: [partner.id] }, [north.id]),
        partner.id,
        code,
      );

      expect(card.assignments.map((a) => a.branchName)).toEqual(['North']);
    });

    /**
     * The second ground, and the reason it exists: an owner confirms sales
     * without being posted anywhere, so on postings alone the person a
     * cashier most often reads on a receipt would come back "no such
     * employee".
     */
    it('resolves whoever confirmed a purchase at its own branch', async () => {
      const partner = await createPartner(prisma);
      // A real owner: the standing check inside the settlement asks the
      // database, not the fixture's intentions.
      const owner = await hireStaff(partner.id, RoleName.PARTNER_OWNER);
      const cashier = await hireStaff(partner.id);
      const customer = await createCustomer(prisma);
      const north = await branchOf(partner.id, 'North');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });

      const intent = await intents.create(
        { partnerId: partner.id, partnerBranchId: north.id, grossAmount: '10000' },
        customer.user.id,
      );
      await intents.confirm(intent.id, owner.id);
      const ownersCode = await employees.codeFor(partner.id, owner.id);

      const card = await controller.byCode(
        actor(cashier.id, [RoleName.PARTNER_STAFF], { PARTNER_STAFF: [partner.id] }, [north.id]),
        partner.id,
        ownersCode,
      );

      expect(card.code).toBe(ownersCode);
      // The owner has no posting, and an empty list is the honest answer —
      // not a reason to refuse the lookup.
      expect(card.assignments).toEqual([]);
    });

    it('still refuses when that purchase was at another branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await hireStaff(partner.id, RoleName.PARTNER_OWNER);
      const cashier = await hireStaff(partner.id);
      const customer = await createCustomer(prisma);
      const north = await branchOf(partner.id, 'North');
      const south = await branchOf(partner.id, 'South');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });

      const intent = await intents.create(
        { partnerId: partner.id, partnerBranchId: south.id, grossAmount: '10000' },
        customer.user.id,
      );
      await intents.confirm(intent.id, owner.id);
      const ownersCode = await employees.codeFor(partner.id, owner.id);

      await expect(
        controller.byCode(
          actor(cashier.id, [RoleName.PARTNER_STAFF], { PARTNER_STAFF: [partner.id] }, [north.id]),
          partner.id,
          ownersCode,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('what the card refuses to say', () => {
    it('carries no phone, no email and no user id', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const staff = await hireStaff(partner.id);
      const north = await branchOf(partner.id, 'North');
      await branchStaff.assign(partner.id, north.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });
      const code = await employees.codeFor(partner.id, staff.id);

      const card = await controller.byCode(
        actor(owner.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [partner.id] }),
        partner.id,
        code,
      );

      const serialised = JSON.stringify(card);
      expect(serialised).not.toContain(staff.phone);
      expect(serialised).not.toContain(staff.id);
    });

    /**
     * A code that does not exist and a code this caller may not resolve have
     * to look identical. The moment they differ, the endpoint answers "does
     * EMP-042 work here" for anybody who can reach it.
     */
    it('answers a code that does not exist exactly as one it may not resolve', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const [cashier, stranger] = [await hireStaff(partner.id), await hireStaff(partner.id)];
      const north = await branchOf(partner.id, 'North');
      const south = await branchOf(partner.id, 'South');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, south.id, {
        userId: stranger.id,
        assignedByUserId: owner.id,
      });
      const takenCode = await employees.codeFor(partner.id, stranger.id);
      const caller = actor(
        cashier.id,
        [RoleName.PARTNER_STAFF],
        { PARTNER_STAFF: [partner.id] },
        [north.id],
      );

      const refusals = await Promise.all(
        [takenCode, 'EMP-999'].map((code) =>
          controller.byCode(caller, partner.id, code).catch((err: Error) => ({
            name: err.constructor.name,
            message: err.message,
          })),
        ),
      );

      expect(refusals[0]).toEqual(refusals[1]);
    });
  });

  describe('the list of people, not postings', () => {
    it('gives the owner everyone, including people posted nowhere', async () => {
      const partner = await createPartner(prisma);
      const owner = await hireStaff(partner.id, RoleName.PARTNER_OWNER);
      const cashier = await hireStaff(partner.id);
      const north = await branchOf(partner.id, 'North');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      // By code, not by name: the fixture gives everybody the same name, and
      // two people with one name is the case the code exists for.
      const ownersCode = await employees.codeFor(partner.id, owner.id);

      const listed = await controller.list(
        actor(owner.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [partner.id] }),
        partner.id,
      );

      expect(listed).toHaveLength(2);
      expect(listed.find((row) => row.code === ownersCode)?.branches).toEqual([]);
    });

    it('counts somebody working two branches once', async () => {
      const partner = await createPartner(prisma);
      const owner = await hireStaff(partner.id, RoleName.PARTNER_OWNER);
      const cashier = await hireStaff(partner.id);
      const north = await branchOf(partner.id, 'North');
      const south = await branchOf(partner.id, 'South');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, south.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });

      const listed = await controller.list(
        actor(owner.id, [RoleName.PARTNER_OWNER], { PARTNER_OWNER: [partner.id] }),
        partner.id,
      );

      const cashiersCode = await employees.codeFor(partner.id, cashier.id);
      const row = listed.find((r) => r.code === cashiersCode)!;
      expect(row.branches.map((b) => b.branchName).sort()).toEqual(['North', 'South']);
      expect(listed.filter((r) => r.code === cashiersCode)).toHaveLength(1);
    });

    it('shows a cashier only the people at their own branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await hireStaff(partner.id, RoleName.PARTNER_OWNER);
      const cashier = await hireStaff(partner.id);
      const stranger = await hireStaff(partner.id);
      const north = await branchOf(partner.id, 'North');
      const south = await branchOf(partner.id, 'South');
      await branchStaff.assign(partner.id, north.id, {
        userId: cashier.id,
        assignedByUserId: owner.id,
      });
      await branchStaff.assign(partner.id, south.id, {
        userId: stranger.id,
        assignedByUserId: owner.id,
      });

      const listed = await controller.list(
        actor(cashier.id, [RoleName.PARTNER_STAFF], { PARTNER_STAFF: [partner.id] }, [north.id]),
        partner.id,
      );

      expect(listed.map((r) => r.code)).toEqual([await employees.codeFor(partner.id, cashier.id)]);
    });
  });
});
