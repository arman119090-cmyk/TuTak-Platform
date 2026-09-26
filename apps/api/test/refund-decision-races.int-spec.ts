import { BadRequestException } from '@nestjs/common';
import { PrismaClient, RefundRequestStatus, RoleName } from '@prisma/client';
import { hashIdempotencyRequest } from '../src/modules/ledger/idempotency.service';
import { PurchaseIntentRefundRequestService } from '../src/modules/purchase-intents/purchase-intent-refund-request.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What happens to a refund decision when two people, or one person's phone
 * retrying, reach it at the same moment.
 *
 * `refund-dual-control.int-spec.ts` pins who may ask and who may decide.
 * This file pins something narrower and more dangerous: that the *decision
 * row* is the only thing that decides, that no path can un-decide a decision
 * whose money may already have moved, and that a refund and the record of it
 * are never separable — not by a race, not by a retry, not by a crash.
 *
 * Every interleaving here is driven deliberately rather than hoped for. A
 * test that races two promises and waits to get lucky proves nothing on the
 * run where it happens to pass.
 */
describe('Refund decision races (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let requests: PurchaseIntentRefundRequestService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    requests = harness.app.get(PurchaseIntentRefundRequestService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(prisma);
  });

  const userWithRole = async (partnerId: string, role: RoleName) => {
    const { user } = await createCustomer(prisma);
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id, partnerId } });
    return user;
  };

  /** A confirmed purchase with a pending request on it, and two deciders. */
  const pendingRequest = async () => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const owner = await userWithRole(partner.id, RoleName.PARTNER_OWNER);
    const manager = await userWithRole(partner.id, RoleName.PARTNER_MANAGER);
    const staff = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
    const { user: customer } = await createCustomer(prisma);

    const intent = await purchaseIntents.create(
      { partnerId: partner.id, grossAmount: '10000' },
      customer.id,
    );
    await purchaseIntents.confirm(intent.id, owner.id);

    const request = await requests.request({
      purchaseIntentId: intent.id,
      amount: '4000',
      reason: 'customer returned a jacket',
      requestedByUserId: staff.id,
    });

    return { partner, owner, manager, staff, customer, intent, request };
  };

  /**
   * Holds the *next* read of the decision row until released, so a second
   * caller can be driven in between a method's read and its write. This is
   * the interleaving that matters and the one a plain `Promise.all` cannot
   * be relied on to produce.
   */
  const holdNextDecisionRead = () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = requests.findOrThrow.bind(requests);
    // The flag is set before the first await, not after it: restoring the
    // spy from inside its own body leaves a window in which the *second*
    // caller is held too, and two callers waiting on the same release is a
    // deadlock rather than a race.
    let held_once = false;
    jest.spyOn(requests, 'findOrThrow').mockImplementation(async (requestId: string) => {
      if (held_once) return real(requestId);
      held_once = true;
      const row = await real(requestId);
      await held;
      return row;
    });
    return { release };
  };

  const refundCount = () => prisma.purchaseIntentRefund.count();

  it('a rejection that started before an approval cannot overwrite it', async () => {
    const { owner, manager, request } = await pendingRequest();

    // The manager opens the request and starts refusing it. Between reading
    // the row and writing the refusal, the owner approves it for real and
    // the money moves.
    const { release } = holdNextDecisionRead();
    const refusing = requests.reject(request.id, manager.id, 'not our policy');
    await requests.approve(request.id, owner.id);
    release();
    await refusing.catch(() => undefined);

    const after = await prisma.purchaseIntentRefundRequest.findUniqueOrThrow({
      where: { id: request.id },
    });

    // The refusal must lose. Money moved; a row saying REJECTED would tell
    // the returns screen, the audit trail and the partner that a customer
    // was turned down, while their wallet says otherwise.
    expect(after.status).toBe(RefundRequestStatus.APPROVED);
    expect(after.refundId).not.toBeNull();
    expect(after.decidedByUserId).toBe(owner.id);
    expect(await refundCount()).toBe(1);
  });

  it('a retry that collides with a decision still being applied does not un-decide it', async () => {
    const { owner, request } = await pendingRequest();

    // Stand in for "the first approval is still running": the idempotency
    // key it would claim is already IN_FLIGHT and inside its lease, which is
    // exactly what a second attempt from the same approver meets when a
    // phone retries a request that has not answered yet.
    const row = await prisma.purchaseIntentRefundRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    await prisma.idempotencyRecord.create({
      data: {
        scope: `purchase-intent-refund:${owner.id}`,
        key: `refund-request:${request.id}`,
        // The hash the engine itself would compute, so this reaches the
        // "still running" branch rather than the "key reused with a
        // different body" one. The two mean opposite things here.
        requestHash: hashIdempotencyRequest({
          purchaseIntentId: row.purchaseIntentId,
          amount: row.amount ? row.amount.toString() : null,
          reason: row.reason,
        }),
        status: 'IN_FLIGHT',
      },
    });

    await expect(requests.approve(request.id, owner.id)).rejects.toThrow();

    const after = await prisma.purchaseIntentRefundRequest.findUniqueOrThrow({
      where: { id: request.id },
    });

    // The decision must stand. Releasing it here hands the request back to
    // the queue while the first attempt is still in flight — and the next
    // approver gets a different actor-scoped idempotency key, which is a
    // second refund for the same request.
    expect(after.status).toBe(RefundRequestStatus.APPROVED);
    expect(after.decidedByUserId).toBe(owner.id);
  });

  it('a decision whose work will never run is released for a human to take again', async () => {
    const { owner, request } = await pendingRequest();

    // The other `ConflictException` the idempotency store raises: the key is
    // claimed with a *different* request body, so the engine will never run
    // this work. Nothing was posted and nothing will be, so holding the
    // decision would wedge the request APPROVED with no refund behind it
    // forever. This is the distinction the typed in-flight exception exists
    // to make — matching on the message text would have worked until
    // somebody improved the wording.
    await prisma.idempotencyRecord.create({
      data: {
        scope: `purchase-intent-refund:${owner.id}`,
        key: `refund-request:${request.id}`,
        requestHash: 'a-different-request-entirely',
        status: 'IN_FLIGHT',
      },
    });

    await expect(requests.approve(request.id, owner.id)).rejects.toThrow();

    const after = await prisma.purchaseIntentRefundRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe(RefundRequestStatus.PENDING);
    // The decider stays on the row. Clearing it was the original bug: the
    // next approver would be a different actor, and an actor-scoped
    // idempotency key that differs is a second refund waiting to happen.
    expect(after.decidedByUserId).toBe(owner.id);
    expect(await refundCount()).toBe(0);
  });

  it('one request can never become two refunds, whoever approves it', async () => {
    const { owner, manager, request } = await pendingRequest();

    await requests.approve(request.id, owner.id);
    // A second approver arrives at a request that is already settled —
    // through a stale queue, a second tab, or the retry above.
    await requests.approve(request.id, manager.id).catch(() => undefined);

    expect(await refundCount()).toBe(1);
    const intent = await prisma.purchaseIntent.findUniqueOrThrow({
      where: { id: request.purchaseIntentId },
    });
    expect(intent.refundedAmount.toFixed(2)).toBe('4000.00');
  });

  it('a direct refund waits for a request being raised, and then refuses', async () => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const owner = await userWithRole(partner.id, RoleName.PARTNER_OWNER);
    const staff = await userWithRole(partner.id, RoleName.PARTNER_STAFF);
    const { user: customer } = await createCustomer(prisma);
    const intent = await purchaseIntents.create(
      { partnerId: partner.id, grossAmount: '10000' },
      customer.id,
    );
    await purchaseIntents.confirm(intent.id, owner.id);

    // A cashier's request is written and its purchase locked, but not yet
    // committed. The owner starts a direct refund on the same purchase. The
    // direct route exists on the promise that it can never step around a
    // cashier who asked, so it must block on that lock and then find the
    // request — not read past it and win.
    //
    // Driven by the lock rather than by sleeps or a spy: the earlier version
    // of this test patched the root client's `findFirst`, which the fix then
    // moved inside a transaction, leaving the test to pass or fail on
    // timing. A test that is right only when the machine is slow is worse
    // than no test.
    let releaseTx!: () => void;
    const txHeld = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });
    let lockTaken!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockTaken = resolve;
    });

    const raising = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM purchase_intents WHERE id = ${intent.id} FOR UPDATE`;
        await tx.purchaseIntentRefundRequest.create({
          data: {
            purchaseIntentId: intent.id,
            partnerId: partner.id,
            partnerBranchId: null,
            amount: '2000',
            reason: 'cashier asked first',
            requestedByUserId: staff.id,
          },
        });
        lockTaken();
        await txHeld;
      },
      { timeout: 20_000 },
    );

    await locked;
    const refunding = requests.refundDirectly({
      purchaseIntentId: intent.id,
      amount: '3000',
      reason: 'owner decided',
      actorId: owner.id,
      idempotencyKey: 'owner-direct-1',
    });
    releaseTx();
    await raising;

    await expect(refunding).rejects.toBeInstanceOf(BadRequestException);
    expect(await refundCount()).toBe(0);
  });

  it('a direct refund never moves money without leaving its record', async () => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const owner = await userWithRole(partner.id, RoleName.PARTNER_OWNER);
    const { user: customer } = await createCustomer(prisma);
    const intent = await purchaseIntents.create(
      { partnerId: partner.id, grossAmount: '10000' },
      customer.id,
    );
    await purchaseIntents.confirm(intent.id, owner.id);

    // The process dies between the money moving and the record being
    // written. A refund that exists only in the ledger is precisely the
    // "quieter path" the direct route was rewritten to eliminate.
    const realCreate = prisma.purchaseIntentRefundRequest.create.bind(
      prisma.purchaseIntentRefundRequest,
    );
    jest.spyOn(prisma.purchaseIntentRefundRequest, 'create').mockImplementation((() => {
      throw new Error('process died before the record was written');
    }) as never);

    await requests
      .refundDirectly({
        purchaseIntentId: intent.id,
        amount: '3000',
        reason: 'owner decided',
        actorId: owner.id,
        idempotencyKey: 'owner-direct-2',
      })
      .catch(() => undefined);

    jest
      .spyOn(prisma.purchaseIntentRefundRequest, 'create')
      .mockImplementation(realCreate as never);

    const refunds = await refundCount();
    const records = await prisma.purchaseIntentRefundRequest.count();
    // Either both exist or neither does. A refund with no record is money
    // that moved and left no trace where every other refund shows up.
    expect(records).toBe(refunds);
  });
});
