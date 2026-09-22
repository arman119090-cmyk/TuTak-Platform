import {
  PartnerBranchState,
  PermissionName,
  PrismaClient,
  PurchaseIntentStatus,
  RoleName,
} from '@prisma/client';
import { PurchaseIntentsController } from '../src/modules/purchase-intents/purchase-intents.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Which branch a restaurant's purchase happened at — and why "none" cannot be
 * an answer once the restaurant has branches.
 *
 * Branch scoping was built for fuel stations, and it shows: the rule that a
 * purchase must name a branch is written as `partner.category === 'fuel'`.
 * Every other category keeps `partnerBranchId` optional, which is right for a
 * single-shop business and wrong the moment a business has locations, because
 * three separate mechanisms then disagree about a branch-less row:
 *
 *  - `branchFilterFor` builds `{ partnerBranchId: { in: [...] } }`, and in SQL
 *    `IN` never matches NULL — so the purchase is invisible in every
 *    branch-scoped queue.
 *  - `assertResourceBranchScope` skips the branch check entirely when the
 *    branch is null — so the same purchase is confirmable by *any* of the
 *    partner's staff, including a cashier assigned to a different branch, as
 *    soon as they know its confirmation code.
 *  - the branch columns on `Transaction`/`PurchaseIntent` stay null, so the
 *    money is in the partner's totals and in no branch's.
 *
 * Invisible in the queue, confirmable out of it, and attributed nowhere. The
 * fix generalises the rule to what it always meant — a purchase must name a
 * branch when the partner *has* branches — which subsumes the fuel case
 * rather than adding a second special case beside it.
 */
describe('A restaurant purchase names the branch it happened at (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let intents: PurchaseIntentsController;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    intents = harness.app.get(PurchaseIntentsController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const restaurant = () =>
    createPartner(prisma, { category: 'restaurant', displayName: 'Dolmama', bonusAccrualRateBps: 500 });

  /**
   * `state` is written alongside `isActive` because the database refuses the
   * two coming apart — they are one fact, and a fixture that set only the
   * boolean was describing a branch that cannot exist.
   */
  const branch = (partnerId: string, name: string, isActive = true) =>
    prisma.partnerBranch.create({
      data: {
        partnerId,
        name,
        address: `${name} street`,
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
        isActive,
        state: isActive ? PartnerBranchState.ACTIVE : PartnerBranchState.SUSPENDED,
      },
    });

  const staffUser = async (partnerId: string, role: RoleName = RoleName.PARTNER_STAFF) => {
    const { user } = await createCustomer(prisma);
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id, partnerId } });
    return user;
  };

  const asUser = (
    id: string,
    role: RoleName,
    partnerId: string,
    extra: Partial<RequestUser> = {},
  ): RequestUser =>
    ({
      id,
      phone: '+37400000000',
      roles: [role],
      permissions: [PermissionName.PURCHASE_INTENT_CONFIRM],
      partnerScopes: { [role]: [partnerId] },
      mustChangePassword: false,
      ...extra,
    }) as RequestUser;

  /** A cashier who works at exactly one branch, with the assignment row to match. */
  const cashierAt = async (partnerId: string, branchId: string, code: string) => {
    const user = await staffUser(partnerId);
    await prisma.partnerBranchStaffAssignment.create({
      data: {
        partnerId,
        partnerBranchId: branchId,
        userId: user.id,
        employeeDisplayCode: code,
        assignedByUserId: user.id,
      },
    });
    return asUser(user.id, RoleName.PARTNER_STAFF, partnerId, { branchIds: [branchId] });
  };

  const customerUser = async (): Promise<RequestUser> => {
    const { user } = await createCustomer(prisma);
    return {
      id: user.id,
      phone: user.phone,
      roles: [RoleName.CUSTOMER],
      permissions: [],
      partnerScopes: {},
      mustChangePassword: false,
    } as RequestUser;
  };

  // ── The rule itself ──────────────────────────────────────────────────

  it('refuses a purchase that names no branch when the restaurant has one', async () => {
    const partner = await restaurant();
    await branch(partner.id, 'Northern Avenue');
    const customer = await customerUser();

    await expect(
      intents.create(customer, { partnerId: partner.id, grossAmount: '10000' }),
    ).rejects.toThrow(/branch/i);

    expect(await prisma.purchaseIntent.count()).toBe(0);
  });

  it('still allows a branch-less purchase at a restaurant with no branches at all', async () => {
    // A single café that never created a location row. Branch scoping has
    // nothing to say about it, and refusing here would break every partner
    // who has not gone through the locations page.
    const partner = await restaurant();
    const customer = await customerUser();

    const intent = await intents.create(customer, { partnerId: partner.id, grossAmount: '10000' });

    expect(intent.partnerBranchId).toBeNull();
  });

  it('ignores branches that are closed when deciding whether one must be named', async () => {
    // A restaurant that shut its only location is back to being a business
    // with nowhere to walk into; its purchases cannot name a branch that is
    // no longer open, and `create` refuses an inactive branch by name too.
    const partner = await restaurant();
    await branch(partner.id, 'Closed for renovation', false);
    const customer = await customerUser();

    const intent = await intents.create(customer, { partnerId: partner.id, grossAmount: '10000' });

    expect(intent.partnerBranchId).toBeNull();
  });

  it('accepts the purchase once the branch is named', async () => {
    const partner = await restaurant();
    const north = await branch(partner.id, 'Northern Avenue');
    const customer = await customerUser();

    const intent = await intents.create(customer, {
      partnerId: partner.id,
      partnerBranchId: north.id,
      grossAmount: '10000',
    });

    expect(intent.partnerBranchId).toBe(north.id);
  });

  // ── What the rule is for ─────────────────────────────────────────────

  it('keeps a cashier from confirming a purchase made at another branch', async () => {
    const partner = await restaurant();
    const north = await branch(partner.id, 'Northern Avenue');
    const mall = await branch(partner.id, 'Dalma Mall');
    const customer = await customerUser();

    const intent = await intents.create(customer, {
      partnerId: partner.id,
      partnerBranchId: north.id,
      grossAmount: '10000',
    });

    const mallCashier = await cashierAt(partner.id, mall.id, 'B-002');
    await expect(intents.confirm(mallCashier, intent.id)).rejects.toMatchObject({ status: 403 });

    const after = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
  });

  it('lets the cashier of the branch the customer is standing in confirm it', async () => {
    const partner = await restaurant();
    const north = await branch(partner.id, 'Northern Avenue');
    await branch(partner.id, 'Dalma Mall');
    const customer = await customerUser();

    const intent = await intents.create(customer, {
      partnerId: partner.id,
      partnerBranchId: north.id,
      grossAmount: '10000',
    });

    const northCashier = await cashierAt(partner.id, north.id, 'B-001');
    const confirmed = await intents.confirm(northCashier, intent.id);

    expect(confirmed.status).toBe(PurchaseIntentStatus.CONFIRMED);
  });

  it('shows a branch cashier their own branch queue and nobody else’s', async () => {
    // The other half of the same property: with a branch always present,
    // "what this cashier may confirm" and "what this cashier can see" are
    // finally the same set. A branch-less row used to be in neither list and
    // confirmable by everyone.
    const partner = await restaurant();
    const north = await branch(partner.id, 'Northern Avenue');
    const mall = await branch(partner.id, 'Dalma Mall');

    const a = await customerUser();
    const b = await customerUser();
    const atNorth = await intents.create(a, {
      partnerId: partner.id,
      partnerBranchId: north.id,
      grossAmount: '10000',
    });
    await intents.create(b, {
      partnerId: partner.id,
      partnerBranchId: mall.id,
      grossAmount: '20000',
    });

    const northCashier = await cashierAt(partner.id, north.id, 'B-001');
    const queue = await intents.list(northCashier, partner.id, PurchaseIntentStatus.AWAITING_CONFIRMATION);

    expect(queue.map((i) => i.id)).toEqual([atNorth.id]);
  });

  it('carries the branch onto the transaction, so a branch’s takings are its own', async () => {
    const partner = await restaurant();
    const north = await branch(partner.id, 'Northern Avenue');
    const customer = await customerUser();

    const intent = await intents.create(customer, {
      partnerId: partner.id,
      partnerBranchId: north.id,
      grossAmount: '10000',
    });
    const cashier = await cashierAt(partner.id, north.id, 'B-001');
    await intents.confirm(cashier, intent.id);

    const row = await prisma.purchaseIntent.findUniqueOrThrow({
      where: { id: intent.id },
      select: { sourceTransactionId: true },
    });
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: row.sourceTransactionId! },
    });
    expect(transaction.partnerBranchId).toBe(north.id);
  });

  // ── The fuel rule this one replaces ──────────────────────────────────

  it('still refuses a branch-less purchase at a fuel station', async () => {
    const partner = await createPartner(prisma, { category: 'fuel' });
    await branch(partner.id, 'Yerevan-Sevan highway');
    const customer = await customerUser();

    await expect(
      intents.create(customer, { partnerId: partner.id, grossAmount: '10000' }),
    ).rejects.toThrow(/branch/i);
  });

  it('keeps the fuel floor even for a station that has no branch rows yet', async () => {
    // The general rule alone would have let this through, and that would be
    // a loosening, not a generalisation: which product a station sold is a
    // per-branch fact, so a station with no branches has nowhere to record
    // what was bought. `partner-branch-staff-and-qr.int-spec.ts` pins the
    // same case; this is here so the restaurant rule cannot be rewritten
    // later without someone seeing what it is standing next to.
    const partner = await createPartner(prisma, { category: 'fuel' });
    const customer = await customerUser();

    await expect(
      intents.create(customer, { partnerId: partner.id, grossAmount: '10000' }),
    ).rejects.toThrow(/branch/i);
  });
});
