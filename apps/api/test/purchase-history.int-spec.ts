import { PrismaClient, PurchaseIntentStatus, RoleName } from '@prisma/client';
import { PurchaseHistoryService } from '../src/modules/purchase-intents/purchase-history.service';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * One purchase has a history, not a single confirmation.
 *
 * The failure this guards against is a screen that reads "confirmed by
 * EMP-004" and treats it as the whole story: the same purchase may have
 * been approved by one person, paid through a provider, and refunded by a
 * third a week later. The second failure it guards against is the opposite
 * one — filling those gaps in for a purchase that predates the columns that
 * would have recorded them.
 */
describe('Purchase history (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let history: PurchaseHistoryService;
  let intents: PurchaseIntentsService;
  let refunds: PurchaseIntentRefundService;
  let branchStaff: PartnerBranchStaffService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    history = harness.app.get(PurchaseHistoryService);
    intents = harness.app.get(PurchaseIntentsService);
    refunds = harness.app.get(PurchaseIntentRefundService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
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

  const aConfirmedSale = async (grossAmount = '10000') => {
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
      { partnerId: partner.id, partnerBranchId: branch.id, grossAmount },
      customer.user.id,
    );
    await intents.confirm(intent.id, cashier.id);
    return { partner, ownerUser, cashier, customer, branch, intent };
  };

  const typesOf = (events: { type: string }[]) => events.map((event) => event.type);

  it('records the customer opening it and the cashier confirming it as two facts', async () => {
    const { intent } = await aConfirmedSale();

    const result = await history.forIntent(intent.id);

    expect(result.status).toBe(PurchaseIntentStatus.CONFIRMED);
    expect(typesOf(result.events)).toContain('CREATED');
    expect(typesOf(result.events)).toContain('CONFIRMED');
    const created = result.events.find((event) => event.type === 'CREATED')!;
    const confirmed = result.events.find((event) => event.type === 'CONFIRMED')!;
    // Different actors, and the customer is never described as staff.
    expect(created.actor.kind).toBe('CUSTOMER');
    expect(confirmed.actor).toMatchObject({ kind: 'STAFF', frozen: true });
  });

  it('marks the confirmation as frozen and a refund as looked up now', async () => {
    const { partner, ownerUser, cashier, intent } = await aConfirmedSale();
    await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '1000',
      reason: 'Customer returned an item',
      actorId: ownerUser.id,
      idempotencyKey: 'refund-history-1',
    });
    expect(partner.id).toBeTruthy();

    const result = await history.forIntent(intent.id);
    const confirmed = result.events.find((event) => event.type === 'CONFIRMED')!;
    const refunded = result.events.find((event) => event.type === 'REFUNDED')!;

    // The distinction the brief asks for: what the row recorded on the day
    // against what the payroll says today. A screen that prints both as the
    // same kind of fact makes a transfer between branches rewrite history.
    expect(confirmed.actor).toMatchObject({ kind: 'STAFF', frozen: true });
    expect(refunded.actor).toMatchObject({ kind: 'STAFF', frozen: false });
    expect(refunded.detail.amount).toBe('1000.0000');
    // The owner has never confirmed a sale, so no permanent code was ever
    // issued to them. They are still this partner's person, and saying
    // "TuTak" about the business's own owner would be simply wrong.
    expect((refunded.actor as { employeeCode: string | null }).employeeCode).toBeNull();
    expect(refunded.detail.reason).toBe('Customer returned an item');
    expect(cashier.id).toBeTruthy();
  });

  it('never invents an actor for a purchase confirmed before the columns existed', async () => {
    const { intent } = await aConfirmedSale();
    // Exactly the shape of a row from before the confirmation columns: a
    // confirmed purchase whose source was never recorded.
    await prisma.purchaseIntent.update({
      where: { id: intent.id },
      data: {
        confirmationSource: null,
        confirmedByEmployeeCode: null,
        confirmedByAssignmentId: null,
        confirmedByRole: null,
        confirmedByApiKeyId: null,
      },
    });

    const result = await history.forIntent(intent.id);
    const confirmed = result.events.find((event) => event.type === 'CONFIRMED')!;

    expect(confirmed.actor).toEqual({ kind: 'NOT_RECORDED' });
    expect(JSON.stringify(confirmed)).not.toContain('EMP-');
  });

  it('orders events by when they happened, with a stable tie-break', async () => {
    const { partner, ownerUser, intent } = await aConfirmedSale();
    await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '500',
      reason: 'Partial return',
      actorId: ownerUser.id,
      idempotencyKey: 'refund-history-2',
    });
    expect(partner.id).toBeTruthy();

    const first = await history.forIntent(intent.id);
    const second = await history.forIntent(intent.id);

    expect(typesOf(first.events)).toEqual(typesOf(second.events));
    const stamps = first.events.map((event) => event.at);
    expect([...stamps].sort()).toEqual(stamps);
    // Creation before confirmation before the refund, whatever the clock did.
    expect(typesOf(first.events).indexOf('CREATED')).toBeLessThan(
      typesOf(first.events).indexOf('CONFIRMED'),
    );
    expect(typesOf(first.events).indexOf('CONFIRMED')).toBeLessThan(
      typesOf(first.events).indexOf('REFUNDED'),
    );
  });

  it('names a rejection and its reason separately from a confirmation', async () => {
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
      { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '4000' },
      customer.user.id,
    );
    await intents.reject(intent.id, cashier.id, {
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      comment: 'Customer changed their mind',
    });

    const result = await history.forIntent(intent.id);
    const rejected = result.events.find((event) => event.type === 'REJECTED')!;

    expect(rejected).toBeDefined();
    expect(rejected.detail.reason).toBe(
      'CUSTOMER_CHANGED_MIND: Customer changed their mind',
    );
    expect(rejected.actor).toMatchObject({ kind: 'STAFF', frozen: false });
    // A rejected purchase was never confirmed, and the history must not say
    // it was.
    expect(typesOf(result.events)).not.toContain('CONFIRMED');
  });

  it('says TuTak, and nothing more, when the actor is not on this payroll', async () => {
    const { partner, intent } = await aConfirmedSale();
    const platformAdmin = await createStaffUser(prisma);
    await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '200',
      reason: 'Goodwill',
      actorId: platformAdmin.id,
      idempotencyKey: 'refund-history-3',
    });
    expect(partner.id).toBeTruthy();

    const result = await history.forIntent(intent.id);
    const refunded = result.events.find((event) => event.type === 'REFUNDED')!;

    expect(refunded.actor).toEqual({ kind: 'TUTAK' });
    // A platform administrator's identity is not a partner's to read.
    expect(JSON.stringify(refunded)).not.toContain(platformAdmin.id);
  });

  it('hands out no raw user ids anywhere in the history', async () => {
    const { partner, ownerUser, cashier, customer, intent } = await aConfirmedSale();
    await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '300',
      reason: 'Return',
      actorId: ownerUser.id,
      idempotencyKey: 'refund-history-4',
    });
    expect(partner.id).toBeTruthy();

    const serialised = JSON.stringify(await history.forIntent(intent.id));

    for (const id of [ownerUser.id, cashier.id, customer.user.id]) {
      expect(serialised).not.toContain(id);
    }
  });

  it('quotes the same short reference the account activity prints', async () => {
    const { intent } = await aConfirmedSale();

    const result = await history.forIntent(intent.id);

    expect(result.reference).toBe(intent.id.replace(/-/g, '').slice(-8).toUpperCase());
  });

  it('refuses a purchase that does not exist rather than returning an empty history', async () => {
    await expect(
      history.forIntent('11111111-1111-1111-1111-111111111111'),
    ).rejects.toThrow(/not found/i);
  });
});
