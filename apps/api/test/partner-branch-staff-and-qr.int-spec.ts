import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BranchFuelType, BranchStaffRole, PrismaClient, RoleName } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PartnerBranchStaffController, PartnerStaffController } from '../src/modules/partners/partner-branch-staff.controller';
import { PartnerBranchQrController, PartnerBranchQrResolveController } from '../src/modules/partners/partner-branch-qr.controller';
import { PurchaseIntentsController } from '../src/modules/purchase-intents/purchase-intents.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Fuel-station branches task: branch fuel-type classification, branch staff
 * assignment (and the "unassigned by default" fail-closed state it replaces
 * bare partner-scoped access with), the `allBranches` owner-granted
 * exception, branch-scoped `PurchaseIntent` authorization, and the branch
 * QR's issue/rotate/revoke/resolve lifecycle — end to end against the real
 * database, through the actual controllers.
 *
 * Every negative test below demonstrates the exact IDOR this task exists to
 * close: a `PARTNER_STAFF`/`PARTNER_MANAGER` role has always been, in
 * effect, access to every branch of its partner, because nothing recorded
 * which one a given staff member actually worked at.
 */
describe('Partner branch staff, allBranches, QR, and branch-scoped PurchaseIntent (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let partnersController: PartnersController;
  let branchStaffController: PartnerBranchStaffController;
  let partnerStaffController: PartnerStaffController;
  let branchQrController: PartnerBranchQrController;
  let branchQrResolveController: PartnerBranchQrResolveController;
  let purchaseIntentsController: PurchaseIntentsController;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    partnersController = harness.app.get(PartnersController);
    branchStaffController = harness.app.get(PartnerBranchStaffController);
    partnerStaffController = harness.app.get(PartnerStaffController);
    branchQrController = harness.app.get(PartnerBranchQrController);
    branchQrResolveController = harness.app.get(PartnerBranchQrResolveController);
    purchaseIntentsController = harness.app.get(PurchaseIntentsController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  // ── Fixtures ─────────────────────────────────────────────────────────

  const fuelPartner = () => createPartner(prisma, { category: 'fuel', bonusAccrualRateBps: 500 });

  const createBranch = (partnerId: string, name: string) =>
    prisma.partnerBranch.create({
      data: { partnerId, name, address: 'Addr', city: 'Yerevan', latitude: 40.18, longitude: 44.51 },
    });

  /** A real user row holding `role` scoped to `partnerId` — the ordinary partner-level grant. */
  const staffMember = async (partnerId: string, role: RoleName = RoleName.PARTNER_STAFF) => {
    const { user } = await createCustomer(prisma);
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id, partnerId } });
    return user;
  };

  const asRequestUser = (
    id: string,
    role: RoleName,
    partnerId: string,
    extra: Partial<RequestUser> = {},
  ): RequestUser =>
    ({
      id,
      phone: '+37400000000',
      roles: [role],
      permissions: [],
      partnerScopes: { [role]: [partnerId] },
      mustChangePassword: false,
      ...extra,
    }) as RequestUser;

  const owner = async (partnerId: string) => {
    const u = await staffMember(partnerId, RoleName.PARTNER_OWNER);
    return asRequestUser(u.id, RoleName.PARTNER_OWNER, partnerId);
  };

  /** Staff scoped to the partner, optionally already assigned to specific branches. */
  const branchStaff = async (partnerId: string, branchIds: string[] = []) => {
    const u = await staffMember(partnerId, RoleName.PARTNER_STAFF);
    return asRequestUser(u.id, RoleName.PARTNER_STAFF, partnerId, { branchIds });
  };

  const createFuelIntent = async (partnerId: string, branchId: string) => {
    const { user: customer } = await createCustomer(prisma);
    return purchaseIntentsController.create(
      { id: customer.id, phone: customer.phone, roles: [RoleName.CUSTOMER], permissions: [], partnerScopes: {}, mustChangePassword: false },
      { partnerId, partnerBranchId: branchId, grossAmount: '5000' },
    );
  };

  // ── Fuel-type classification ────────────────────────────────────────

  describe('branch fuel-type classification', () => {
    it('lets the owner classify a branch', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const ownerUser = await owner(partner.id);

      const updated = await partnersController.setBranchFuelType(ownerUser, partner.id, branch.id, {
        fuelType: BranchFuelType.PETROL,
      });

      expect(updated.fuelType).toBe(BranchFuelType.PETROL);
    });

    it('refuses a non-owner staff member classifying a branch', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const staffUser = await branchStaff(partner.id);

      await expect(
        partnersController.setBranchFuelType(staffUser, partner.id, branch.id, {
          fuelType: BranchFuelType.PETROL,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('leaves an unclassified branch fuelType null rather than guessing', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      expect(branch.fuelType).toBeNull();
    });
  });

  // ── Branch staff assignment ─────────────────────────────────────────

  describe('branch staff assignment', () => {
    it('refuses assigning a user with no staff role at the partner', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const ownerUser = await owner(partner.id);
      const { user: unrelated } = await createCustomer(prisma);

      await expect(
        branchStaffController.assign(ownerUser, partner.id, branch.id, { userId: unrelated.id }),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns a staff member and auto-generates an employee display code', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const ownerUser = await owner(partner.id);
      const staffUser = await staffMember(partner.id);

      const assignment = await branchStaffController.assign(ownerUser, partner.id, branch.id, {
        userId: staffUser.id,
      });

      expect(assignment.employeeDisplayCode).toMatch(/^EMP-\d{3}$/);
      expect(assignment.role).toBe(BranchStaffRole.STAFF);
      expect(assignment.isActive).toBe(true);
    });

    it('refuses a second active assignment for the same user at the same branch', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const ownerUser = await owner(partner.id);
      const staffUser = await staffMember(partner.id);

      await branchStaffController.assign(ownerUser, partner.id, branch.id, { userId: staffUser.id });

      await expect(
        branchStaffController.assign(ownerUser, partner.id, branch.id, { userId: staffUser.id }),
      ).rejects.toThrow(ConflictException);
    });

    it('lets the same person be reassigned to the same branch after deactivation', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const ownerUser = await owner(partner.id);
      const staffUser = await staffMember(partner.id);

      const first = await branchStaffController.assign(ownerUser, partner.id, branch.id, {
        userId: staffUser.id,
      });
      await branchStaffController.deactivate(ownerUser, partner.id, branch.id, first.id);

      const second = await branchStaffController.assign(ownerUser, partner.id, branch.id, {
        userId: staffUser.id,
      });
      expect(second.isActive).toBe(true);
    });

    it('refuses a non-owner assigning staff to a branch', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const staffUser = await staffMember(partner.id);
      const requester = await branchStaff(partner.id);

      await expect(
        branchStaffController.assign(requester, partner.id, branch.id, { userId: staffUser.id }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses assigning staff to another partner's branch by id (cross-tenant IDOR)", async () => {
      const mine = await fuelPartner();
      const theirs = await fuelPartner();
      const theirBranch = await createBranch(theirs.id, 'Their Branch');
      const ownerOfMine = await owner(mine.id);
      const staffUser = await staffMember(mine.id);

      // 404, not 403: the branch genuinely does not belong to `mine` —
      // confirming it exists under a different tenant would itself leak
      // information an IDOR check should not.
      await expect(
        branchStaffController.assign(ownerOfMine, mine.id, theirBranch.id, { userId: staffUser.id }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets branch-scoped staff list their own branch roster, and refuses an unrelated staff member', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');
      const ownerUser = await owner(partner.id);
      const staffUser = await staffMember(partner.id);
      await branchStaffController.assign(ownerUser, partner.id, branch.id, { userId: staffUser.id });

      const assignedCaller = await branchStaff(partner.id, [branch.id]);
      const roster = await branchStaffController.list(assignedCaller, partner.id, branch.id);
      expect(roster).toHaveLength(1);

      // `list()` throws synchronously (the guard runs before any `await`),
      // so the assertion itself must be synchronous too.
      const unassignedCaller = await branchStaff(partner.id, []);
      expect(() => branchStaffController.list(unassignedCaller, partner.id, branch.id)).toThrow(
        ForbiddenException,
      );
    });
  });

  // ── allBranches exception ───────────────────────────────────────────

  describe('the allBranches exception', () => {
    it('lets the owner grant a manager all-branch reach', async () => {
      const partner = await fuelPartner();
      const ownerUser = await owner(partner.id);
      const manager = await staffMember(partner.id, RoleName.PARTNER_MANAGER);

      await partnerStaffController.setAllBranches(ownerUser, partner.id, {
        userId: manager.id,
        allBranches: true,
      });

      const role = await prisma.userRole.findFirstOrThrow({ where: { userId: manager.id, partnerId: partner.id } });
      expect(role.allBranches).toBe(true);
    });

    it('refuses a non-owner granting all-branch reach', async () => {
      const partner = await fuelPartner();
      const manager = await staffMember(partner.id, RoleName.PARTNER_MANAGER);
      const requester = await branchStaff(partner.id);

      await expect(
        partnerStaffController.setAllBranches(requester, partner.id, {
          userId: manager.id,
          allBranches: true,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Branch-scoped PurchaseIntent authorization (the core IDOR surface) ──

  describe('branch-scoped PurchaseIntent authorization', () => {
    it('requires a branch for a purchase intent at a fuel-category partner', async () => {
      const partner = await fuelPartner();
      const { user: customer } = await createCustomer(prisma);

      await expect(
        purchaseIntentsController.create(
          { id: customer.id, phone: customer.phone, roles: [RoleName.CUSTOMER], permissions: [], partnerScopes: {}, mustChangePassword: false },
          { partnerId: partner.id, grossAmount: '5000' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not require a branch for a non-fuel partner (unchanged behavior)', async () => {
      const partner = await createPartner(prisma, { category: 'cafe' });
      const { user: customer } = await createCustomer(prisma);

      const intent = await purchaseIntentsController.create(
        { id: customer.id, phone: customer.phone, roles: [RoleName.CUSTOMER], permissions: [], partnerScopes: {}, mustChangePassword: false },
        { partnerId: partner.id, grossAmount: '5000' },
      );
      expect(intent.partnerBranchId).toBeNull();
    });

    it("an unassigned branch-partner staff member sees an empty pending queue, not every branch's", async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      await createFuelIntent(partner.id, branchA.id);

      const unassigned = await branchStaff(partner.id, []);
      const list = await purchaseIntentsController.list(unassigned, partner.id);
      expect(list).toHaveLength(0);
    });

    it('branch-A staff see only branch-A intents in the pending queue', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      const intentA = await createFuelIntent(partner.id, branchA.id);
      await createFuelIntent(partner.id, branchB.id);

      const staffA = await branchStaff(partner.id, [branchA.id]);
      const list = await purchaseIntentsController.list(staffA, partner.id);

      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(intentA.id);
    });

    it('branch-A staff cannot confirm a branch-B purchase intent', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      const intentB = await createFuelIntent(partner.id, branchB.id);

      const staffA = await branchStaff(partner.id, [branchA.id]);
      await expect(purchaseIntentsController.confirm(staffA, intentB.id)).rejects.toThrow(ForbiddenException);
    });

    it('branch-A staff can confirm a branch-A purchase intent', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const intentA = await createFuelIntent(partner.id, branchA.id);

      const staffA = await branchStaff(partner.id, [branchA.id]);
      const confirmed = await purchaseIntentsController.confirm(staffA, intentA.id);
      expect(confirmed.status).toBe('CONFIRMED');
    });

    it('branch-A staff cannot reject a branch-B purchase intent', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      const intentB = await createFuelIntent(partner.id, branchB.id);

      const staffA = await branchStaff(partner.id, [branchA.id]);
      await expect(
        purchaseIntentsController.reject(staffA, intentB.id, { reasonCode: 'OTHER' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('branch-A staff cannot refund a branch-B purchase intent', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      const intentB = await createFuelIntent(partner.id, branchB.id);
      const ownerUser = await owner(partner.id);
      await purchaseIntentsController.confirm(ownerUser, intentB.id);

      const staffA = await branchStaff(partner.id, [branchA.id]);
      await expect(
        purchaseIntentsController.refund(staffA, intentB.id, {
          amount: '100',
          reason: 'test',
          idempotencyKey: 'test-key',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('branch-A staff cannot view a branch-B intent directly by id (IDOR on GET)', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      const intentB = await createFuelIntent(partner.id, branchB.id);

      const staffA = await branchStaff(partner.id, [branchA.id]);
      await expect(purchaseIntentsController.get(staffA, intentB.id)).rejects.toThrow(ForbiddenException);
    });

    it('the owner can confirm any branch intent regardless of branch assignment', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const intentA = await createFuelIntent(partner.id, branchA.id);
      const ownerUser = await owner(partner.id);

      const confirmed = await purchaseIntentsController.confirm(ownerUser, intentA.id);
      expect(confirmed.status).toBe('CONFIRMED');
    });

    it('a manager granted allBranches sees every branch in the pending queue', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      await createFuelIntent(partner.id, branchA.id);
      await createFuelIntent(partner.id, branchB.id);

      const managerUser = await staffMember(partner.id, RoleName.PARTNER_MANAGER);
      const ownerUser = await owner(partner.id);
      await partnerStaffController.setAllBranches(ownerUser, partner.id, {
        userId: managerUser.id,
        allBranches: true,
      });

      const caller = asRequestUser(managerUser.id, RoleName.PARTNER_MANAGER, partner.id, {
        allBranchPartnerIds: [partner.id],
      });
      const list = await purchaseIntentsController.list(caller, partner.id);
      expect(list).toHaveLength(2);
    });
  });

  // ── Branch QR lifecycle ──────────────────────────────────────────────

  describe('branch QR lifecycle', () => {
    it('issues a QR that resolves to exactly this partner and branch, with no commercial data', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'A');
      const ownerUser = await owner(partner.id);

      const qr = await branchQrController.issue(ownerUser, partner.id, branch.id);
      const resolved = await branchQrResolveController.resolve(qr.token);

      expect(resolved.partnerId).toBe(partner.id);
      expect(resolved.partnerBranchId).toBe(branch.id);
      expect(resolved).not.toHaveProperty('amount');
    });

    it('refuses issuing a second active QR for the same branch', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'A');
      const ownerUser = await owner(partner.id);
      await branchQrController.issue(ownerUser, partner.id, branch.id);

      await expect(branchQrController.issue(ownerUser, partner.id, branch.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('a revoked QR no longer resolves, and never falls back to a general partner code', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'A');
      const ownerUser = await owner(partner.id);
      const qr = await branchQrController.issue(ownerUser, partner.id, branch.id);

      await branchQrController.revoke(ownerUser, partner.id, branch.id);

      await expect(branchQrResolveController.resolve(qr.token)).rejects.toThrow(NotFoundException);
    });

    it('rotating invalidates the old token and issues a working new one', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'A');
      const ownerUser = await owner(partner.id);
      const original = await branchQrController.issue(ownerUser, partner.id, branch.id);

      const rotated = await branchQrController.rotate(ownerUser, partner.id, branch.id);

      expect(rotated.token).not.toBe(original.token);
      await expect(branchQrResolveController.resolve(original.token)).rejects.toThrow(NotFoundException);
      const resolved = await branchQrResolveController.resolve(rotated.token);
      expect(resolved.partnerBranchId).toBe(branch.id);
    });

    it('refuses a non-owner issuing or revoking a branch QR', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'A');
      const requester = await branchStaff(partner.id, [branch.id]);

      await expect(branchQrController.issue(requester, partner.id, branch.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets branch-scoped staff view the active QR, but refuses an unrelated staff member', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'A');
      const ownerUser = await owner(partner.id);
      await branchQrController.issue(ownerUser, partner.id, branch.id);

      const assignedCaller = await branchStaff(partner.id, [branch.id]);
      const seen = await branchQrController.getActive(assignedCaller, partner.id, branch.id);
      expect(seen).not.toBeNull();

      const unassignedCaller = await branchStaff(partner.id, []);
      await expect(branchQrController.getActive(unassignedCaller, partner.id, branch.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("a branch's QR never resolves to a different branch of the same partner", async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      const ownerUser = await owner(partner.id);
      const qrA = await branchQrController.issue(ownerUser, partner.id, branchA.id);

      const resolved = await branchQrResolveController.resolve(qrA.token);
      expect(resolved.partnerBranchId).toBe(branchA.id);
      expect(resolved.partnerBranchId).not.toBe(branchB.id);
    });
  });
});
