import { ForbiddenException } from '@nestjs/common';
import { PrismaClient, PurchaseIntentStatus, RoleName } from '@prisma/client';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { UsersService } from '../src/modules/users/users.service';
import { assertResourceBranchScope } from '../src/common/auth/branch-scope';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The window between "the claims said yes" and "the money moved".
 *
 * Every request rebuilds its claims from the database, so a dismissed
 * cashier is refused on their *next* request without waiting for a token to
 * expire. That was already true and is asserted here so it stays true. It
 * says nothing about the request already in flight:
 *
 *   1. the request reads the claims and they permit the act;
 *   2. the owner ends the posting, removes the role, or disables the account;
 *   3. the request commits the sale.
 *
 * These tests drive exactly that order — the revocation is performed from
 * inside the confirmation, after the claims and the employee snapshot have
 * been read and before the settlement transaction opens — and require the
 * sale to be refused.
 *
 * The mirror case matters just as much: a revocation that lands *after* the
 * check inside the transaction must not undo a sale that had already legally
 * happened. Promising otherwise would be promising to reverse settled money.
 */
describe('Standing at the moment of the financial change (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let intents: PurchaseIntentsService;
  let branchStaff: PartnerBranchStaffService;
  let bonuses: BonusEngineService;
  let users: UsersService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    intents = harness.app.get(PurchaseIntentsService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
    bonuses = harness.app.get(BonusEngineService);
    users = harness.app.get(UsersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
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

  /**
   * A cashier at a branch with a purchase waiting to be confirmed — the
   * state every test below starts from.
   */
  const aTillWithASaleWaiting = async () => {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const cashier = await hireStaff(partner.id);
    const customer = await createCustomer(prisma);
    const branch = await branchOf(partner.id, 'North');
    const posting = await branchStaff.assign(partner.id, branch.id, {
      userId: cashier.id,
      assignedByUserId: owner.id,
    });
    const intent = await intents.create(
      { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
      customer.user.id,
    );
    return { partner, owner, cashier, customer, branch, posting, intent };
  };

  /**
   * Runs `revoke` inside the confirmation, at the one moment that matters:
   * after the request's claims and the employee snapshot have been read, and
   * before the settlement transaction opens. `confirmationFor` is the last
   * thing `confirm` does before settling, and it ends by reading the
   * assignment — so hooking its read is hooking that instant.
   */
  const revokeMidConfirmation = (revoke: () => Promise<unknown>) => {
    const service = intents as unknown as {
      confirmationFor: (...args: unknown[]) => Promise<unknown>;
    };
    const original = service.confirmationFor.bind(service);
    jest
      .spyOn(service, 'confirmationFor')
      .mockImplementation(async (...args: unknown[]) => {
        const resolved = await original(...args);
        await revoke();
        return resolved;
      });
  };

  describe('a revocation that lands before the money moves', () => {
    it('refuses a sale by somebody whose posting was just ended', async () => {
      const { partner, owner, cashier, branch, posting, intent } = await aTillWithASaleWaiting();
      revokeMidConfirmation(() => branchStaff.deactivate(partner.id, posting.id, owner.id));

      await expect(intents.confirm(intent.id, cashier.id)).rejects.toThrow(ForbiddenException);

      const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(after.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
      expect(after.confirmedAt).toBeNull();
      // Nothing half-done: the settlement transaction rolled back whole.
      expect(await prisma.ledgerPosting.count()).toBe(0);
      expect(branch.id).toBeDefined();
    });

    it('refuses a sale by somebody whose partner role was just removed', async () => {
      const { partner, cashier, intent } = await aTillWithASaleWaiting();
      revokeMidConfirmation(() =>
        prisma.userRole.deleteMany({ where: { userId: cashier.id, partnerId: partner.id } }),
      );

      await expect(intents.confirm(intent.id, cashier.id)).rejects.toThrow(ForbiddenException);
      expect(await prisma.ledgerPosting.count()).toBe(0);
    });

    it('refuses a sale by somebody whose account was just disabled', async () => {
      const { cashier, intent } = await aTillWithASaleWaiting();
      revokeMidConfirmation(() =>
        prisma.user.update({ where: { id: cashier.id }, data: { isActive: false } }),
      );

      await expect(intents.confirm(intent.id, cashier.id)).rejects.toThrow(ForbiddenException);
      expect(await prisma.ledgerPosting.count()).toBe(0);
    });

    /**
     * The claims the request was admitted on are *still* permissive at this
     * point — which is the whole reason the check inside the transaction has
     * to exist. Without this assertion the tests above could be passing for
     * some other reason.
     */
    it('is not caught by the check the request came in on', async () => {
      const { partner, owner, cashier, branch, posting } = await aTillWithASaleWaiting();
      const claimsAtRequestStart: RequestUser = {
        ...(await users.buildRequestUserClaims(cashier.id)),
        deviceId: 'device-1',
      };

      await branchStaff.deactivate(partner.id, posting.id, owner.id);

      // Read before the revocation, so they still say yes afterwards.
      expect(() =>
        assertResourceBranchScope(claimsAtRequestStart, partner.id, branch.id),
      ).not.toThrow();
    });
  });

  describe('a revocation that lands after the money moved', () => {
    /**
     * The sale completed while the person still had standing. The owner's
     * dismissal is real and takes effect — but it does not reach backwards
     * into a settled purchase, and the two do not deadlock.
     */
    it('leaves the confirmed sale alone and still takes effect', async () => {
      const { partner, owner, cashier, posting, intent } = await aTillWithASaleWaiting();

      // Kept as a resolved promise rather than a nullable one: the
      // assignment below happens inside a mock, which the compiler cannot
      // see running, so a nullable holder reads here as "still null".
      let dismissal: Promise<unknown> = Promise.resolve();
      let dismissed = false;
      const accrue = bonuses.accrue.bind(bonuses);
      jest.spyOn(bonuses, 'accrue').mockImplementation(async (...args: Parameters<typeof accrue>) => {
        // Fired from another connection while the settlement holds its share
        // lock, and deliberately not awaited here: it cannot finish until
        // this transaction commits, and awaiting it would be the deadlock.
        if (!dismissed) {
          dismissed = true;
          dismissal = branchStaff.deactivate(partner.id, posting.id, owner.id);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        return accrue(...args);
      });

      const confirmed = await intents.confirm(intent.id, cashier.id);
      await dismissal;

      expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);
      expect(
        (await prisma.partnerBranchStaffAssignment.findUniqueOrThrow({ where: { id: posting.id } }))
          .isActive,
      ).toBe(false);
    });
  });

  describe('the ordinary next request', () => {
    it('no longer carries the branch a dismissed cashier used to reach', async () => {
      const { partner, owner, cashier, branch, posting } = await aTillWithASaleWaiting();
      const before = await users.buildRequestUserClaims(cashier.id);
      expect(before.branchIds).toContain(branch.id);

      await branchStaff.deactivate(partner.id, posting.id, owner.id);

      const after = await users.buildRequestUserClaims(cashier.id);
      expect(after.branchIds).not.toContain(branch.id);
      expect(() =>
        assertResourceBranchScope({ ...after, deviceId: 'd' }, partner.id, branch.id),
      ).toThrow(ForbiddenException);
    });

    it('refuses a disabled account outright rather than narrowing it', async () => {
      const { cashier } = await aTillWithASaleWaiting();
      await prisma.user.update({ where: { id: cashier.id }, data: { isActive: false } });

      await expect(users.buildRequestUserClaims(cashier.id)).rejects.toThrow();
    });
  });

  describe('who this does not apply to', () => {
    it('lets an owner confirm although they are posted to no branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await hireStaff(partner.id, RoleName.PARTNER_OWNER);
      const customer = await createCustomer(prisma);
      const branch = await branchOf(partner.id, 'North');
      const intent = await intents.create(
        { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
        customer.user.id,
      );

      const confirmed = await intents.confirm(intent.id, owner.id);

      expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);
    });

    it('does not ask a provider callback for standing it never had', async () => {
      const partner = await createPartner(prisma);
      const customer = await createCustomer(prisma);
      const intent = await intents.create(
        { partnerId: partner.id, grossAmount: '10000' },
        customer.user.id,
      );

      await prisma.$transaction((tx) => intents.settleFromProviderConfirmation(intent.id, tx));

      const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(after.status).toBe(PurchaseIntentStatus.CONFIRMED);
      expect(after.confirmedByUserId).toBeNull();
    });
  });
});
