import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionName, PrismaClient, RoleName } from '@prisma/client';
import { PartnerSettlementPartnerController } from '../src/modules/partner-settlements/partner-settlement.controller';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * One sale, and what it did to the debt.
 *
 * The statement answers "why do you owe me this much" with days and
 * amounts. This is the next question, asked about one line, and the two
 * requirements that shape the answer are opposite: it has to be complete
 * enough for the partner to check their own contract, and it must not leak
 * what TuTak does with its own share afterwards.
 */
describe('Partner purchase breakdown (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: PartnerSettlementPartnerController;
  let intents: PurchaseIntentsService;
  let branchStaff: PartnerBranchStaffService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(PartnerSettlementPartnerController);
    intents = harness.app.get(PurchaseIntentsService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const owner = (id: string, partnerId: string): RequestUser => ({
    id,
    phone: '+37400000000',
    roles: [RoleName.PARTNER_OWNER],
    permissions: [],
    partnerScopes: { PARTNER_OWNER: [partnerId] },
    branchIds: [],
    allBranchPartnerIds: [partnerId],
    mustChangePassword: false,
  });

  const hire = async (partnerId: string, role: RoleName = RoleName.PARTNER_STAFF) => {
    const user = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: role } })).id,
        partnerId,
      },
    });
    return user;
  };

  /** A confirmed sale at a branch, with a cashier who has real standing. */
  const aConfirmedSale = async () => {
    const partner = await createPartner(prisma);
    const ownerUser = await hire(partner.id, RoleName.PARTNER_OWNER);
    const cashier = await hire(partner.id);
    const customer = await createCustomer(prisma);
    const branch = await prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: 'North',
        address: 'North 1',
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      },
    });
    await branchStaff.assign(partner.id, branch.id, {
      userId: cashier.id,
      assignedByUserId: ownerUser.id,
    });
    const intent = await intents.create(
      { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
      customer.user.id,
    );
    await intents.confirm(intent.id, cashier.id);
    return { partner, ownerUser, cashier, branch, intent };
  };

  it('is gated on the same permission as the rest of the money reads', () => {
    const permissions = Reflect.getMetadata(
      'permissions',
      (controller as unknown as Record<string, unknown>).purchaseBreakdown as object,
    ) as PermissionName[];
    expect(permissions).toContain(PermissionName.SETTLEMENT_READ);
  });

  it('names the sale, the branch and who confirmed it', async () => {
    const { partner, ownerUser, cashier, branch, intent } = await aConfirmedSale();

    const breakdown = await controller.purchaseBreakdown(
      owner(ownerUser.id, partner.id),
      partner.id,
      intent.id,
    );

    expect(breakdown.purchaseIntentId).toBe(intent.id);
    expect(breakdown.branchId).toBe(branch.id);
    expect(breakdown.confirmationSource).toBe('STAFF');
    expect(breakdown.employeeCode).toMatch(/^EMP-\d{3}$/);
    expect(cashier.id).toBeTruthy();
  });

  it('splits the sale into what funded it, and says who holds the money', async () => {
    const { partner, ownerUser, intent } = await aConfirmedSale();

    const breakdown = await controller.purchaseBreakdown(
      owner(ownerUser.id, partner.id),
      partner.id,
      intent.id,
    );

    expect(breakdown.grossAmount).toBe('10000.0000');
    // Nothing was paid with points or balance, so the whole sale was
    // collected at the till — the partner's own money, never TuTak's.
    expect(breakdown.externalAmount).toBe('10000.0000');
    expect(breakdown.externalCollectedBy).toBe('PARTNER_TILL');
  });

  it('itemises the ledger lines and where each one stands', async () => {
    const { partner, ownerUser, intent } = await aConfirmedSale();

    const breakdown = await controller.purchaseBreakdown(
      owner(ownerUser.id, partner.id),
      partner.id,
      intent.id,
    );

    expect(breakdown.lines.length).toBeGreaterThan(0);
    // Nothing has been drafted or paid yet, so every line is still owing —
    // and the three buckets add up to the whole effect.
    expect(breakdown.lines.every((line) => line.state === 'UNSETTLED')).toBe(true);
    expect(breakdown.inOpenSettlement).toBe('0.0000');
    expect(breakdown.paid).toBe('0.0000');
    expect(breakdown.stillOwed).toBe(breakdown.effectOnDebt);
  });

  /**
   * The partner's own contractual deduction is theirs to check. What the
   * platform does with its share afterwards — the customer's points, the
   * deferred part, three levels of referral, TuTak's residual — is not on
   * this screen and must not be derivable from it.
   */
  it('does not disclose TuTak’s own economics', async () => {
    const { partner, ownerUser, intent } = await aConfirmedSale();
    const stored = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });

    const breakdown = await controller.purchaseBreakdown(
      owner(ownerUser.id, partner.id),
      partner.id,
      intent.id,
    );
    const serialised = JSON.stringify(breakdown);

    for (const secret of ['poolAmount', 'greenAmount', 'deferredAmount', 'tutakAmount', 'referrer1Amount']) {
      expect(Object.keys(breakdown)).not.toContain(secret);
    }
    // And not as a value either: the pool is a number a reader could match
    // against the kinds if it appeared anywhere.
    if (stored.tutakAmount && !stored.tutakAmount.isZero()) {
      expect(serialised).not.toContain(stored.tutakAmount.toFixed(4));
    }
  });

  it('answers another partner’s purchase exactly as a nonexistent one', async () => {
    const { intent } = await aConfirmedSale();
    const other = await createPartner(prisma, { displayName: 'Other' });
    const otherOwner = await hire(other.id, RoleName.PARTNER_OWNER);

    const refusals = await Promise.all(
      [intent.id, '11111111-2222-3333-4444-555555555555'].map((id) =>
        controller
          .purchaseBreakdown(owner(otherOwner.id, other.id), other.id, id)
          .catch((err: Error) => ({ name: err.constructor.name, message: err.message })),
      ),
    );

    expect(refusals[0]).toEqual(refusals[1]);
    expect((refusals[0] as { name: string }).name).toBe(NotFoundException.name);
  });

  it('refuses a partner reading somebody else’s organisation', async () => {
    const { partner, intent } = await aConfirmedSale();
    const other = await createPartner(prisma, { displayName: 'Other' });
    const otherOwner = await hire(other.id, RoleName.PARTNER_OWNER);

    await expect(
      controller.purchaseBreakdown(owner(otherOwner.id, other.id), partner.id, intent.id),
    ).rejects.toThrow(ForbiddenException);
  });
});
