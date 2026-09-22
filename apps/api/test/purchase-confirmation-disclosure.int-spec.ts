import { PrismaClient, PurchaseConfirmationSource, PurchaseIntentStatus } from '@prisma/client';
import { PartnerEmployeeService } from '../src/modules/partners/partner-employee.service';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What a purchase says about who confirmed it, on the wire and in the
 * database.
 *
 * The question a partner actually asks is "who at my business let this
 * through", and until now the answer they were handed was `confirmedByUserId`
 * — a platform user id, meaningless to them, and null in two different
 * situations that mean opposite things: a payment provider confirmed it, or
 * the purchase predates the record. The DTO now carries the source as a
 * union, and these tests hold three things to it: the union says what
 * happened, the storage columns do not leak alongside it, and the database
 * refuses a row that claims two kinds of confirmation at once.
 */
describe('Purchase confirmation disclosure (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let intents: PurchaseIntentsService;
  let employees: PartnerEmployeeService;
  let branchStaff: PartnerBranchStaffService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    intents = harness.app.get(PurchaseIntentsService);
    employees = harness.app.get(PartnerEmployeeService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** A member of staff with the partner-scoped role an assignment needs. */
  const hireStaff = async (partnerId: string) => {
    const staff = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: staff.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: 'PARTNER_STAFF' } })).id,
        partnerId,
      },
    });
    return staff;
  };

  /** The five columns that must never appear in a response. */
  const STORAGE_COLUMNS = [
    'confirmationSource',
    'confirmedByEmployeeCode',
    'confirmedByAssignmentId',
    'confirmedByRole',
    'confirmedByApiKeyId',
  ];

  describe('a cashier confirming at a till', () => {
    it('names the person by their permanent code, not by a user id', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const customer = await createCustomer(prisma);

      const intent = await intents.create({ partnerId: partner.id, grossAmount: '10000' }, customer.user.id);
      const confirmed = await intents.confirm(intent.id, staff.id);
      const dto = await intents.toDto(confirmed);

      expect(dto.confirmation).toEqual({
        source: PurchaseConfirmationSource.STAFF,
        employeeCode: await employees.codeFor(partner.id, staff.id),
        assignmentId: null,
        role: null,
      });
      // Still written, because released clients read it — the compatibility
      // this change was required to keep.
      expect(dto.confirmedByUserId).toBe(staff.id);
    });

    it('records the posting acted under when the purchase names a branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const staff = await hireStaff(partner.id);
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
      const assignment = await branchStaff.assign(partner.id, branch.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });

      const intent = await intents.create(
        { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '10000' },
        customer.user.id,
      );
      const dto = await intents.toDto(await intents.confirm(intent.id, staff.id));

      expect(dto.confirmation).toMatchObject({
        source: PurchaseConfirmationSource.STAFF,
        assignmentId: assignment.id,
        role: 'STAFF',
      });
    });

    it('keeps saying what it said after the person is moved to another branch', async () => {
      const partner = await createPartner(prisma);
      const owner = await createStaffUser(prisma);
      const staff = await hireStaff(partner.id);
      const customer = await createCustomer(prisma);
      const [north, south] = await Promise.all(
        ['North', 'South'].map((name) =>
          prisma.partnerBranch.create({
            data: {
              partnerId: partner.id,
              name,
              address: `${name} 1`,
              city: 'Yerevan',
              latitude: 40.18,
              longitude: 44.51,
            },
          }),
        ),
      );
      const posting = await branchStaff.assign(partner.id, north!.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });

      const intent = await intents.create(
        { partnerId: partner.id, partnerBranchId: north!.id, grossAmount: '10000' },
        customer.user.id,
      );
      const before = await intents.toDto(await intents.confirm(intent.id, staff.id));

      // The transfer, in the two steps a partner performs it in.
      await branchStaff.assign(partner.id, south!.id, {
        userId: staff.id,
        assignedByUserId: owner.id,
      });
      await prisma.partnerBranchStaffAssignment.update({
        where: { id: posting.id },
        data: { isActive: false, deactivatedAt: new Date() },
      });

      const after = await intents.toDto(await intents.findByIdOrThrow(intent.id));
      expect(after.confirmation).toEqual(before.confirmation);
    });
  });

  describe('the two confirmations no person made', () => {
    it('tells a provider callback apart from a purchase nobody recorded', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const customer = await createCustomer(prisma);

      const provider = await intents.create({ partnerId: partner.id, grossAmount: '10000' }, customer.user.id);
      // The provider path settles inside the caller's transaction, because
      // the cash leg and the settlement have to commit together.
      await prisma.$transaction((tx) => intents.settleFromProviderConfirmation(provider.id, tx));

      // A purchase from before these columns existed: confirmed, with an
      // actor, and no recorded source. The shape every historical row has.
      const legacy = await intents.create({ partnerId: partner.id, grossAmount: '10000' }, customer.user.id);
      await intents.confirm(legacy.id, staff.id);
      await prisma.$executeRaw`
        UPDATE "purchase_intents"
        SET "confirmationSource" = NULL,
            "confirmedByEmployeeCode" = NULL,
            "confirmedByAssignmentId" = NULL,
            "confirmedByRole" = NULL
        WHERE "id" = ${legacy.id}
      `;

      const providerDto = await intents.toDto(await intents.findByIdOrThrow(provider.id));
      const legacyDto = await intents.toDto(await intents.findByIdOrThrow(legacy.id));

      expect(providerDto.confirmation).toEqual({
        source: PurchaseConfirmationSource.PROVIDER_CALLBACK,
      });
      expect(providerDto.confirmedByUserId).toBeNull();

      // Both have a null actor; only one of them means "nobody acted". The
      // whole point of the column is that these two are no longer the same
      // answer.
      expect(legacyDto.confirmation).toBeNull();
      expect(legacyDto.confirmedByUserId).toBe(staff.id);
    });

    it('leaves an unconfirmed purchase with nothing to say', async () => {
      const partner = await createPartner(prisma);
      const customer = await createCustomer(prisma);

      const intent = await intents.create({ partnerId: partner.id, grossAmount: '10000' }, customer.user.id);
      const dto = await intents.toDto(intent);

      expect(dto.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);
      expect(dto.confirmation).toBeNull();
    });
  });

  describe('the storage columns stay in the database', () => {
    it('sends the union and none of the five columns behind it', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const customer = await createCustomer(prisma);

      const intent = await intents.create({ partnerId: partner.id, grossAmount: '10000' }, customer.user.id);
      const dto = await intents.toDto(await intents.confirm(intent.id, staff.id));

      for (const column of STORAGE_COLUMNS) {
        expect(Object.keys(dto)).not.toContain(column);
      }
    });

    it('sends them from the list endpoint no more than from the single one', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const customer = await createCustomer(prisma);

      const intent = await intents.create({ partnerId: partner.id, grossAmount: '10000' }, customer.user.id);
      await intents.confirm(intent.id, staff.id);

      const rows = await prisma.purchaseIntent.findMany({ where: { partnerId: partner.id } });
      const [dto] = await intents.toDtos(rows);

      expect(dto!.confirmation).toMatchObject({ source: PurchaseConfirmationSource.STAFF });
      for (const column of STORAGE_COLUMNS) {
        expect(Object.keys(dto!)).not.toContain(column);
      }
    });
  });

  /**
   * The union in TypeScript binds the one writer that goes through it. These
   * are the writers that do not: a backfill, a support fix typed into psql,
   * a second confirmation path written next year.
   */
  describe('the database refuses a half-written confirmation', () => {
    const rowFor = async (partnerId: string, customerId: string, prisma: PrismaClient) =>
      (
        await prisma.purchaseIntent.create({
          data: {
            customerId,
            partnerId,
            grossAmount: '10000',
            ordinaryPaymentRemainder: '10000',
            negotiatedRateBps: 500,
            maxBonusPaymentPercent: 50,
            status: PurchaseIntentStatus.CONFIRMED,
            confirmedAt: new Date(),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        })
      ).id;

    it('refuses a cashier confirmation that names no employee', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const customer = await createCustomer(prisma);
      const id = await rowFor(partner.id, customer.user.id, prisma);

      await expect(
        prisma.$executeRaw`
          UPDATE "purchase_intents"
          SET "confirmationSource" = 'STAFF', "confirmedByUserId" = ${staff.id}
          WHERE "id" = ${id}
        `,
      ).rejects.toThrow(/purchase_intents_confirmation_is_consistent/);
    });

    it('refuses a provider callback that also names a cashier', async () => {
      const partner = await createPartner(prisma);
      const customer = await createCustomer(prisma);
      const id = await rowFor(partner.id, customer.user.id, prisma);

      await expect(
        prisma.$executeRaw`
          UPDATE "purchase_intents"
          SET "confirmationSource" = 'PROVIDER_CALLBACK', "confirmedByEmployeeCode" = 'EMP-001'
          WHERE "id" = ${id}
        `,
      ).rejects.toThrow(/purchase_intents_confirmation_is_consistent/);
    });

    it('refuses an integration confirmation carrying a person', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const customer = await createCustomer(prisma);
      const id = await rowFor(partner.id, customer.user.id, prisma);

      await expect(
        prisma.$executeRaw`
          UPDATE "purchase_intents"
          SET "confirmationSource" = 'PARTNER_INTEGRATION',
              "confirmedByApiKeyId" = 'key-1',
              "confirmedByUserId" = ${staff.id}
          WHERE "id" = ${id}
        `,
      ).rejects.toThrow(/purchase_intents_confirmation_is_consistent/);
    });

    it('refuses an employee code on a row with no recorded source', async () => {
      const partner = await createPartner(prisma);
      const customer = await createCustomer(prisma);
      const id = await rowFor(partner.id, customer.user.id, prisma);

      await expect(
        prisma.$executeRaw`
          UPDATE "purchase_intents"
          SET "confirmedByEmployeeCode" = 'EMP-001'
          WHERE "id" = ${id}
        `,
      ).rejects.toThrow(/purchase_intents_confirmation_is_consistent/);
    });

    it('refuses a posting recorded without the role held under it', async () => {
      const partner = await createPartner(prisma);
      const staff = await createStaffUser(prisma);
      const customer = await createCustomer(prisma);
      const id = await rowFor(partner.id, customer.user.id, prisma);

      await expect(
        prisma.$executeRaw`
          UPDATE "purchase_intents"
          SET "confirmationSource" = 'STAFF',
              "confirmedByUserId" = ${staff.id},
              "confirmedByEmployeeCode" = 'EMP-001',
              "confirmedByAssignmentId" = 'assignment-1'
          WHERE "id" = ${id}
        `,
      ).rejects.toThrow(/purchase_intents_confirmation_posting_is_whole/);
    });
  });
});
