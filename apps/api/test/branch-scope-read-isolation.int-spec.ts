import { PermissionName, PrismaClient, RoleName, TransactionStatus } from '@prisma/client';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PartnerStaffController } from '../src/modules/partners/partner-branch-staff.controller';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { PurchaseIntentsController } from '../src/modules/purchase-intents/purchase-intents.controller';
import { AnalyticsController } from '../src/modules/analytics/analytics.controller';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Branch isolation on the three *read* surfaces that the branch-scoping work
 * left partner-wide: the partner-level staff roster, a partner's transaction
 * history, and a partner's analytics totals.
 *
 * Each one passed `assertPartnerScope`/`hasPartnerScope` and then queried by
 * `partnerId` alone, so a cashier assigned to branch A could read branch B's
 * roster, its operations, and its revenue — the same IDOR class that
 * `partner-branch-staff-and-qr.int-spec.ts` closes for intents and QR, on
 * the endpoints that sweep missed.
 *
 * The two transaction-backed cases are only expressible because
 * `Transaction.partnerBranchId` now exists; before it, no WHERE clause could
 * separate one branch's rows from another's.
 */
describe('Branch-scoped read isolation: staff roster, transactions, analytics (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let partnersController: PartnersController;
  let partnerStaffController: PartnerStaffController;
  let staffService: PartnerBranchStaffService;
  let purchaseIntentsController: PurchaseIntentsController;
  let analyticsController: AnalyticsController;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    partnersController = harness.app.get(PartnersController);
    partnerStaffController = harness.app.get(PartnerStaffController);
    staffService = harness.app.get(PartnerBranchStaffService);
    purchaseIntentsController = harness.app.get(PurchaseIntentsController);
    analyticsController = harness.app.get(AnalyticsController);
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
      permissions: [PermissionName.ANALYTICS_READ],
      partnerScopes: { [role]: [partnerId] },
      mustChangePassword: false,
      ...extra,
    }) as RequestUser;

  const owner = async (partnerId: string) => {
    const u = await staffMember(partnerId, RoleName.PARTNER_OWNER);
    return asRequestUser(u.id, RoleName.PARTNER_OWNER, partnerId);
  };

  const branchStaff = async (partnerId: string, branchIds: string[] = []) => {
    const u = await staffMember(partnerId, RoleName.PARTNER_STAFF);
    return asRequestUser(u.id, RoleName.PARTNER_STAFF, partnerId, { branchIds });
  };

  /** An assignment row — what `branchIds` on the request user is derived from. */
  const assign = (partnerId: string, branchId: string, userId: string, code: string) =>
    prisma.partnerBranchStaffAssignment.create({
      data: {
        partnerId,
        partnerBranchId: branchId,
        userId,
        employeeDisplayCode: code,
        assignedByUserId: userId,
      },
    });

  /** A confirmed purchase at `branchId`, i.e. one COMPLETED transaction carrying that branch. */
  const completedPurchaseAt = async (partnerId: string, branchId: string, grossAmount: string) => {
    const { user: customer } = await createCustomer(prisma);
    const intent = await purchaseIntentsController.create(
      {
        id: customer.id,
        phone: customer.phone,
        roles: [RoleName.CUSTOMER],
        permissions: [],
        partnerScopes: {},
        mustChangePassword: false,
      } as RequestUser,
      { partnerId, partnerBranchId: branchId, grossAmount },
    );
    const confirmer = await owner(partnerId);
    await purchaseIntentsController.confirm(confirmer, intent.id);
    return intent;
  };

  // ── The write that makes the reads below possible ────────────────────

  describe('Transaction.partnerBranchId', () => {
    it('is stamped on the transaction a branch purchase produces', async () => {
      const partner = await fuelPartner();
      const branch = await createBranch(partner.id, 'B1');

      const intent = await completedPurchaseAt(partner.id, branch.id, '5000');

      const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
      const txn = await prisma.transaction.findUniqueOrThrow({
        where: { id: row.sourceTransactionId! },
      });
      expect(txn.partnerBranchId).toBe(branch.id);
      expect(txn.status).toBe(TransactionStatus.COMPLETED);
    });

    it('stays null for a partner-wide operation that names no branch', async () => {
      // A non-fuel partner: fuel partners must name a branch at purchase
      // time, so the branch-less shape only exists off that category — and
      // this is the row a branch-scoped caller must not be shown.
      const partner = await createPartner(prisma, { category: 'retail', bonusAccrualRateBps: 500 });
      const { user: customer } = await createCustomer(prisma);
      const intent = await purchaseIntentsController.create(
        {
          id: customer.id,
          phone: customer.phone,
          roles: [RoleName.CUSTOMER],
          permissions: [],
          partnerScopes: {},
          mustChangePassword: false,
        } as RequestUser,
        { partnerId: partner.id, grossAmount: '5000' },
      );

      const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
      const txn = await prisma.transaction.findUniqueOrThrow({
        where: { id: row.sourceTransactionId! },
      });
      expect(txn.partnerBranchId).toBeNull();
    });
  });

  // ── Finding 1: the partner-level staff roster ────────────────────────

  describe('GET /partners/:id/staff', () => {
    it('does not show branch-A staff the roster of branch B', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');

      const cashierA = await branchStaff(partner.id, [branchA.id]);
      await assign(partner.id, branchA.id, cashierA.id, 'EMP-001');
      const userB = await staffMember(partner.id);
      await assign(partner.id, branchB.id, userB.id, 'EMP-002');

      const roster = await partnerStaffController.list(cashierA, partner.id);

      expect(roster.map((r) => r.userId)).toEqual([cashierA.id]);
      expect(roster.map((r) => r.userId)).not.toContain(userB.id);
    });

    it('still shows the owner every branch', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');

      const userA = await staffMember(partner.id);
      await assign(partner.id, branchA.id, userA.id, 'EMP-001');
      const userB = await staffMember(partner.id);
      await assign(partner.id, branchB.id, userB.id, 'EMP-002');

      const roster = await partnerStaffController.list(await owner(partner.id), partner.id);

      expect(roster.map((r) => r.userId).sort()).toEqual([userA.id, userB.id].sort());
    });

    it('shows an all-branches manager every branch', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');

      const userA = await staffMember(partner.id);
      await assign(partner.id, branchA.id, userA.id, 'EMP-001');
      const userB = await staffMember(partner.id);
      await assign(partner.id, branchB.id, userB.id, 'EMP-002');

      const manager = await branchStaff(partner.id, []);
      const roster = await partnerStaffController.list(
        { ...manager, allBranchPartnerIds: [partner.id] } as RequestUser,
        partner.id,
      );

      expect(roster).toHaveLength(2);
    });

    it('shows unassigned staff nobody, rather than defaulting open', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const userA = await staffMember(partner.id);
      await assign(partner.id, branchA.id, userA.id, 'EMP-001');

      const unassigned = await branchStaff(partner.id, []);

      expect(await partnerStaffController.list(unassigned, partner.id)).toEqual([]);
    });

    it('filters in the query, not over an already-fetched page', async () => {
      // Calling the service directly with an empty filter must produce an
      // empty result set — proving the restriction is a WHERE clause and not
      // a post-filter that a different caller could skip.
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const userA = await staffMember(partner.id);
      await assign(partner.id, branchA.id, userA.id, 'EMP-001');

      expect(await staffService.listForPartner(partner.id, false, [])).toEqual([]);
      expect(await staffService.listForPartner(partner.id, false, [branchA.id])).toHaveLength(1);
      expect(await staffService.listForPartner(partner.id, false, null)).toHaveLength(1);
    });
  });

  // ── Finding 2: a partner's transaction history ───────────────────────

  describe('GET /partners/:id/transactions', () => {
    it('does not show branch-A staff branch B\'s operations', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      await completedPurchaseAt(partner.id, branchA.id, '5000');
      await completedPurchaseAt(partner.id, branchB.id, '9000');

      const cashierA = await branchStaff(partner.id, [branchA.id]);
      const { items } = await partnersController.transactions(cashierA, partner.id, { limit: 20 } as never);

      expect(items).toHaveLength(1);
      expect(items[0]!.amount.toString()).toBe('5000');
    });

    it('still shows the owner both branches', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      await completedPurchaseAt(partner.id, branchA.id, '5000');
      await completedPurchaseAt(partner.id, branchB.id, '9000');

      const { items } = await partnersController.transactions(
        await owner(partner.id),
        partner.id,
        { limit: 20 } as never,
      );

      expect(items).toHaveLength(2);
    });

    it("leaves a customer's own history unrestricted", async () => {
      // The same service method serves `/transactions/me`, which passes no
      // branch filter — a customer must keep seeing every purchase they made,
      // at any branch.
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const intent = await completedPurchaseAt(partner.id, branchA.id, '5000');
      const row = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });

      const transactions = harness.app.get(TransactionsService);
      const { items } = await transactions.history({ userId: row.customerId, limit: 20 } as never);

      expect(items).toHaveLength(1);
    });
  });

  // ── Finding 3: a partner's analytics totals ──────────────────────────

  describe('GET /analytics/partners/:partnerId', () => {
    it('does not fold branch B\'s revenue into branch-A staff\'s totals', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      await completedPurchaseAt(partner.id, branchA.id, '5000');
      await completedPurchaseAt(partner.id, branchB.id, '9000');

      const cashierA = await branchStaff(partner.id, [branchA.id]);
      const report = await analyticsController.partner(cashierA, partner.id, {} as never);

      expect(report.totalTransactions).toBe(1);
      expect(report.totalRevenue).toBe('5000.0000');
      expect(report.uniqueCustomers).toBe(1);
    });

    it('still gives the owner the whole network', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      const branchB = await createBranch(partner.id, 'B');
      await completedPurchaseAt(partner.id, branchA.id, '5000');
      await completedPurchaseAt(partner.id, branchB.id, '9000');

      const report = await analyticsController.partner(await owner(partner.id), partner.id, {} as never);

      expect(report.totalTransactions).toBe(2);
      expect(report.totalRevenue).toBe('14000.0000');
      expect(report.uniqueCustomers).toBe(2);
    });

    it('reports zeroes, not the network total, for unassigned staff', async () => {
      const partner = await fuelPartner();
      const branchA = await createBranch(partner.id, 'A');
      await completedPurchaseAt(partner.id, branchA.id, '5000');

      const unassigned = await branchStaff(partner.id, []);
      const report = await analyticsController.partner(unassigned, partner.id, {} as never);

      expect(report.totalTransactions).toBe(0);
      expect(report.totalRevenue).toBe('0.0000');
    });
  });
});
