import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, RefundRequestStatus, RoleName } from '@prisma/client';
import { AuditAction, PurchaseIntentStatus } from '@prisma/client';
import { PurchaseIntentRefundRequestService } from '../src/modules/purchase-intents/purchase-intent-refund-request.service';
import { PurchaseIntentRefundRequestsController } from '../src/modules/purchase-intents/purchase-intent-refund-requests.controller';
import { PurchaseIntentsController } from '../src/modules/purchase-intents/purchase-intents.controller';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Maker/checker for refunds — the owner's decision of 2026-09-12.
 *
 * The point of this file is the *split*, not the arithmetic: the refund
 * engine's own reversal is already covered exhaustively by
 * `purchase-intent-refund.int-spec.ts` and `refund-clawback-deep.int-spec.ts`,
 * and nothing here re-litigates it. What these tests pin is who may ask, who
 * may decide, that asking moves no money, that deciding moves it exactly
 * once, and that the same person can never do both.
 */
describe('Refund dual control (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let purchaseIntentsController: PurchaseIntentsController;
  let requests: PurchaseIntentRefundRequestService;
  let requestsController: PurchaseIntentRefundRequestsController;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    purchaseIntentsController = harness.app.get(PurchaseIntentsController);
    requests = harness.app.get(PurchaseIntentRefundRequestService);
    requestsController = harness.app.get(PurchaseIntentRefundRequestsController);
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

  /** A confirmed purchase with something left to refund. */
  const confirmedPurchase = async () => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const owner = await userWithRole(partner.id, RoleName.PARTNER_OWNER);
    const { user: customer } = await createCustomer(prisma);
    const intent = await purchaseIntents.create(
      { partnerId: partner.id, grossAmount: '10000' },
      customer.id,
    );
    await purchaseIntents.confirm(intent.id, owner.id);
    return { partner, owner, customer, intent };
  };

  it('lets a cashier ask, and moves nothing at all while it waits', async () => {
    const { partner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '4000',
      reason: 'Customer returned half the order',
      requestedByUserId: cashier.id,
    });

    expect(request.status).toBe(RefundRequestStatus.PENDING);
    expect(request.requestedByUserId).toBe(cashier.id);
    expect(request.decidedByUserId).toBeNull();
    expect(request.refundId).toBeNull();

    // Nothing financial: no refund row, and the purchase still shows the
    // whole amount as unrefunded.
    expect(await prisma.purchaseIntentRefund.count()).toBe(0);
    const after = await purchaseIntents.findByIdOrThrow(intent.id);
    expect(after.refundedAmount.toFixed(4)).toBe('0.0000');

    const audit = await prisma.auditLog.findMany({
      where: { action: AuditAction.PURCHASE_INTENT_REFUND_REQUESTED, entityId: request.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(cashier.id);
  });

  it('moves the money once the owner approves, and links the two records', async () => {
    const { partner, owner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '4000',
      reason: 'Customer returned half the order',
      requestedByUserId: cashier.id,
    });
    const approved = await requests.approve(request.id, owner.id);

    expect(approved.status).toBe(RefundRequestStatus.APPROVED);
    expect(approved.decidedByUserId).toBe(owner.id);
    expect(approved.refundId).toBeTruthy();

    const refunds = await prisma.purchaseIntentRefund.findMany();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.id).toBe(approved.refundId);
    expect(refunds[0]!.amount.toFixed(4)).toBe('4000.0000');
    // The refund is recorded against the person who took the decision, not
    // the one who asked — the request row keeps the other half.
    expect(refunds[0]!.actorId).toBe(owner.id);

    const after = await purchaseIntents.findByIdOrThrow(intent.id);
    expect(after.refundedAmount.toFixed(4)).toBe('4000.0000');
  });

  it('refuses to let the same person approve what they asked for', async () => {
    const { partner, intent } = await confirmedPurchase();
    // Deliberately a manager: someone who *is* allowed to approve, so what
    // is being refused here is the self-approval, not the role.
    const manager = await userWithRole(partner.id, RoleName.PARTNER_MANAGER);

    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '1000',
      reason: 'Damaged',
      requestedByUserId: manager.id,
    });

    await expect(requests.approve(request.id, manager.id)).rejects.toThrow(ForbiddenException);
    expect(await prisma.purchaseIntentRefund.count()).toBe(0);
    const still = await requests.findOrThrow(request.id);
    expect(still.status).toBe(RefundRequestStatus.PENDING);
  });

  it('refuses to let the same person reject what they asked for', async () => {
    const { partner, intent } = await confirmedPurchase();
    const manager = await userWithRole(partner.id, RoleName.PARTNER_MANAGER);
    const request = await requests.request({
      purchaseIntentId: intent.id,
      reason: 'Changed mind',
      requestedByUserId: manager.id,
    });

    // Rejecting your own request is also one person acting as two — and it
    // would let a cashier quietly bury a request a manager should have seen.
    await expect(requests.reject(request.id, manager.id, 'nevermind')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('does not let a cashier approve, whoever asked', async () => {
    const { partner, intent } = await confirmedPurchase();
    const asking = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
    const other = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '1000',
      reason: 'Damaged',
      requestedByUserId: asking.id,
    });

    // Two different people, so the self-approval rule is satisfied — the
    // role is what refuses here. Two cashiers agreeing with each other is
    // not the control this is for.
    await expect(
      requestsController.approve(
        asRequestUser(other.id, RoleName.PARTNER_STAFF, partner.id),
        request.id,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(await prisma.purchaseIntentRefund.count()).toBe(0);
  });

  it('no longer lets a cashier refund directly, and still lets an owner', async () => {
    const { partner, owner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    await expect(
      purchaseIntentsController.refund(
        asRequestUser(cashier.id, RoleName.PARTNER_STAFF, partner.id),
        intent.id,
        { amount: '500', reason: 'test', idempotencyKey: 'cashier-direct-1' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(await prisma.purchaseIntentRefund.count()).toBe(0);

    // The owner of a business with nobody to ask is not locked out of
    // refunding — that is the case the request flow cannot serve.
    await purchaseIntentsController.refund(
      asRequestUser(owner.id, RoleName.PARTNER_OWNER, partner.id),
      intent.id,
      { amount: '500', reason: 'test', idempotencyKey: 'owner-direct-1' },
    );
    expect(await prisma.purchaseIntentRefund.count()).toBe(1);
  });

  it('allows only one undecided request per purchase', async () => {
    const { partner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    await requests.request({
      purchaseIntentId: intent.id,
      amount: '1000',
      reason: 'First',
      requestedByUserId: cashier.id,
    });

    // Two pending requests would each have been written against a
    // `remaining` the other is about to change.
    await expect(
      requests.request({
        purchaseIntentId: intent.id,
        amount: '2000',
        reason: 'Second',
        requestedByUserId: cashier.id,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('frees the purchase for a new request once the first is decided', async () => {
    const { partner, owner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    const first = await requests.request({
      purchaseIntentId: intent.id,
      amount: '1000',
      reason: 'First',
      requestedByUserId: cashier.id,
    });
    await requests.reject(first.id, owner.id, 'No receipt');

    const second = await requests.request({
      purchaseIntentId: intent.id,
      amount: '2000',
      reason: 'Second, with the receipt this time',
      requestedByUserId: cashier.id,
    });
    expect(second.status).toBe(RefundRequestStatus.PENDING);
  });

  it('leaves nothing behind when a request is rejected', async () => {
    const { partner, owner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '1000',
      reason: 'Damaged',
      requestedByUserId: cashier.id,
    });
    const rejected = await requests.reject(request.id, owner.id, 'Bring the receipt');

    expect(rejected.status).toBe(RefundRequestStatus.REJECTED);
    expect(rejected.decidedByUserId).toBe(owner.id);
    expect(rejected.decisionNote).toBe('Bring the receipt');
    expect(await prisma.purchaseIntentRefund.count()).toBe(0);
    const after = await purchaseIntents.findByIdOrThrow(intent.id);
    expect(after.refundedAmount.toFixed(4)).toBe('0.0000');
  });

  it('refunds once even if the approval is repeated', async () => {
    const { partner, owner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '3000',
      reason: 'Returned',
      requestedByUserId: cashier.id,
    });

    const first = await requests.approve(request.id, owner.id);
    const second = await requests.approve(request.id, owner.id);

    expect(second.status).toBe(RefundRequestStatus.APPROVED);
    expect(second.refundId).toBe(first.refundId);
    expect(await prisma.purchaseIntentRefund.count()).toBe(1);
    const after = await purchaseIntents.findByIdOrThrow(intent.id);
    expect(after.refundedAmount.toFixed(4)).toBe('3000.0000');
  });

  it('refunds once even when two approvals race', async () => {
    const { partner, owner, intent } = await confirmedPurchase();
    const manager = await userWithRole(partner.id, RoleName.PARTNER_MANAGER);
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '3000',
      reason: 'Returned',
      requestedByUserId: cashier.id,
    });

    // The owner and the manager both tap Approve on their own screens.
    // Whatever the order, the customer is refunded 3000 once — not twice,
    // and not 6000.
    await Promise.allSettled([
      requests.approve(request.id, owner.id),
      requests.approve(request.id, manager.id),
    ]);

    const refundRows = await prisma.purchaseIntentRefund.findMany();
    expect(refundRows).toHaveLength(1);
    const after = await purchaseIntents.findByIdOrThrow(intent.id);
    expect(after.refundedAmount.toFixed(4)).toBe('3000.0000');
    const decided = await requests.findOrThrow(request.id);
    expect(decided.status).toBe(RefundRequestStatus.APPROVED);
  });

  it('refuses a request for more than is still refundable, while the customer is still there', async () => {
    const { partner, intent } = await confirmedPurchase();
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);

    await expect(
      requests.request({
        purchaseIntentId: intent.id,
        amount: '15000',
        reason: 'Too much',
        requestedByUserId: cashier.id,
      }),
    ).rejects.toThrow(/exceeds/i);
  });

  it('refuses a request against a purchase no cashier ever confirmed', async () => {
    const partner = await createPartner(prisma);
    const { user: customer } = await createCustomer(prisma);
    const cashier = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
    const intent = await purchaseIntents.create(
      { partnerId: partner.id, grossAmount: '5000' },
      customer.id,
    );
    expect(intent.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);

    await expect(
      requests.request({
        purchaseIntentId: intent.id,
        reason: 'Nothing to return yet',
        requestedByUserId: cashier.id,
      }),
    ).rejects.toThrow(/confirmed/i);
  });

  it('keeps one branch’s requests out of another branch’s queue', async () => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const owner = await userWithRole(partner.id, RoleName.PARTNER_OWNER);
    const branchA = await prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: 'A',
        address: '1 Test St',
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      },
    });
    const branchB = await prisma.partnerBranch.create({
      data: {
        partnerId: partner.id,
        name: 'B',
        address: '2 Test St',
        city: 'Yerevan',
        latitude: 40.19,
        longitude: 44.52,
      },
    });
    const { user: customer } = await createCustomer(prisma);
    const intentA = await purchaseIntents.create(
      { partnerId: partner.id, partnerBranchId: branchA.id, grossAmount: '10000' },
      customer.id,
    );
    await purchaseIntents.confirm(intentA.id, owner.id);
    const cashierA = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
    const requested = await requests.request({
      purchaseIntentId: intentA.id,
      amount: '1000',
      reason: 'Returned',
      requestedByUserId: cashierA.id,
    });
    expect(requested.partnerBranchId).toBe(branchA.id);

    const cashierB = {
      ...asRequestUser(
        (await userWithRole(partner.id, RoleName.PARTNER_STAFF)).id,
        RoleName.PARTNER_STAFF,
        partner.id,
      ),
      branchIds: [branchB.id],
    } as RequestUser;

    const visibleToB = await requestsController.list(cashierB, { partnerId: partner.id });
    expect(visibleToB).toHaveLength(0);

    // The owner sees every branch, which is what makes them the approver.
    const visibleToOwner = await requestsController.list(
      asRequestUser(owner.id, RoleName.PARTNER_OWNER, partner.id),
      { partnerId: partner.id },
    );
    expect(visibleToOwner.map((r) => r.id)).toContain(requested.id);
  });
});
