import { ForbiddenException } from '@nestjs/common';
import { PrismaClient, PurchaseIntentStatus, RoleName } from '@prisma/client';
import { PartnerBranchStaffController } from '../src/modules/partners/partner-branch-staff.controller';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { UsersService } from '../src/modules/users/users.service';
import { assertResourceBranchScope } from '../src/common/auth/branch-scope';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * One real employee, one identifiable account.
 *
 * This file is mostly *proof of things that are already true* — the mandate
 * is explicit that what is already right should be pinned rather than
 * rewritten. Three questions an owner will eventually ask, answered from the
 * database rather than from anyone's memory:
 *
 *   - who confirmed this sale, and who refused that one;
 *   - which branches does this person work at, and when did that stop;
 *   - does taking someone's access away actually take it away, now.
 *
 * The last one is the sharpest. Access that only ends at the next login is
 * not access control at all: a dismissed cashier keeps a working phone until
 * their token happens to expire.
 */
describe('Staff identity and branch access (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let users: UsersService;
  let branchStaff: PartnerBranchStaffController;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    users = harness.app.get(UsersService);
    branchStaff = harness.app.get(PartnerBranchStaffController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const userWithRole = async (partnerId: string, role: RoleName) => {
    const { user } = await createCustomer(prisma);
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id, partnerId } });
    return user;
  };

  const asRequestUser = (id: string, role: RoleName, partnerId: string): RequestUser =>
    ({
      id,
      phone: '+37400000000',
      roles: [role],
      permissions: [],
      partnerScopes: { [role]: [partnerId] },
      mustChangePassword: false,
    }) as RequestUser;

  const branchOf = (partnerId: string, name: string) =>
    prisma.partnerBranch.create({
      data: {
        partnerId,
        name,
        address: `${name} street`,
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      },
    });

  describe('who decided', () => {
    it('records the individual who confirmed a sale', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
      const { user: customer } = await createCustomer(prisma);
      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000' },
        customer.id,
      );

      const confirmed = await purchaseIntents.confirm(intent.id, cashier.id);
      expect(confirmed.confirmedByUserId).toBe(cashier.id);
    });

    /**
     * The gap this file was written for. `confirmedByUserId` claimed in its
     * own schema comment to hold "whoever confirmed or rejected", and
     * `reject()` never wrote it — so the one decision a customer is most
     * likely to complain about was the one the row could not attribute.
     */
    it('records the individual who refused one, on the row and not only in the audit log', async () => {
      const partner = await createPartner(prisma);
      const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
      const { user: customer } = await createCustomer(prisma);
      const intent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000' },
        customer.id,
      );

      const rejected = await purchaseIntents.reject(intent.id, cashier.id, {
        reasonCode: 'OUT_OF_STOCK',
      });

      expect(rejected.status).toBe(PurchaseIntentStatus.REJECTED);
      expect(rejected.rejectedByUserId).toBe(cashier.id);
      // And a refusal is not a confirmation: the other column stays empty,
      // so a report cannot read one as the other.
      expect(rejected.confirmedByUserId).toBeNull();
    });

    it('keeps the two decisions on separate people when they are separate people', async () => {
      const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
      const first = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
      const second = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
      const { user: customer } = await createCustomer(prisma);

      const rejectedIntent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '5000' },
        customer.id,
      );
      await purchaseIntents.reject(rejectedIntent.id, first.id, { reasonCode: 'OTHER' });

      const confirmedIntent = await purchaseIntents.create(
        { partnerId: partner.id, grossAmount: '6000' },
        customer.id,
      );
      await purchaseIntents.confirm(confirmedIntent.id, second.id);

      const rejected = await purchaseIntents.findByIdOrThrow(rejectedIntent.id);
      const confirmed = await purchaseIntents.findByIdOrThrow(confirmedIntent.id);
      expect(rejected.rejectedByUserId).toBe(first.id);
      expect(confirmed.confirmedByUserId).toBe(second.id);
      expect(rejected.confirmedByUserId).toBeNull();
      expect(confirmed.rejectedByUserId).toBeNull();
    });
  });

  describe('taking access away', () => {
    it('closes branch access on the very next request, not at the next login', async () => {
      const partner = await createPartner(prisma);
      const owner = await userWithRole(partner.id, RoleName.PARTNER_OWNER);
      const branch = await branchOf(partner.id, 'Kentron');
      const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

      const assignment = await branchStaff.assign(
        asRequestUser(owner.id, RoleName.PARTNER_OWNER, partner.id),
        partner.id,
        branch.id,
        { userId: cashier.id, role: 'STAFF' },
      );

      // Claims are rebuilt from the database on every authenticated request
      // (`JwtStrategy` → `buildRequestUserClaims`), which is what makes the
      // difference between "access removed" and "access removed eventually".
      const before = await users.buildRequestUserClaims(cashier.id);
      expect(before.branchIds).toContain(branch.id);
      expect(() =>
        assertResourceBranchScope(
          {
            ...asRequestUser(cashier.id, RoleName.PARTNER_STAFF, partner.id),
            branchIds: before.branchIds,
          } as RequestUser,
          partner.id,
          branch.id,
        ),
      ).not.toThrow();

      await branchStaff.deactivate(
        asRequestUser(owner.id, RoleName.PARTNER_OWNER, partner.id),
        partner.id,
        branch.id,
        assignment.id,
      );

      const after = await users.buildRequestUserClaims(cashier.id);
      expect(after.branchIds).not.toContain(branch.id);
      expect(() =>
        assertResourceBranchScope(
          {
            ...asRequestUser(cashier.id, RoleName.PARTNER_STAFF, partner.id),
            branchIds: after.branchIds,
          } as RequestUser,
          partner.id,
          branch.id,
        ),
      ).toThrow(ForbiddenException);
    });

    it('records when the access ended and who ended it', async () => {
      const partner = await createPartner(prisma);
      const owner = await userWithRole(partner.id, RoleName.PARTNER_OWNER);
      const branch = await branchOf(partner.id, 'Kentron');
      const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
      const assignment = await branchStaff.assign(
        asRequestUser(owner.id, RoleName.PARTNER_OWNER, partner.id),
        partner.id,
        branch.id,
        { userId: cashier.id, role: 'STAFF' },
      );

      await branchStaff.deactivate(
        asRequestUser(owner.id, RoleName.PARTNER_OWNER, partner.id),
        partner.id,
        branch.id,
        assignment.id,
      );

      const row = await prisma.partnerBranchStaffAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      });
      expect(row.isActive).toBe(false);
      expect(row.deactivatedAt).toBeInstanceOf(Date);
      expect(row.deactivatedByUserId).toBe(owner.id);
      // The assignment is not deleted: who worked where, and when that
      // stopped, is exactly what an owner needs months later.
      expect(row.userId).toBe(cashier.id);
      expect(row.partnerBranchId).toBe(branch.id);
    });

    it('ends every session the moment the account itself is deactivated', async () => {
      const partner = await createPartner(prisma);
      const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

      await prisma.user.update({ where: { id: cashier.id }, data: { isActive: false } });

      // Not "cannot act at this branch" — cannot authenticate at all, on the
      // next request, with the token they are still holding.
      await expect(users.buildRequestUserClaims(cashier.id)).rejects.toThrow(/no longer active/i);
    });
  });
});
