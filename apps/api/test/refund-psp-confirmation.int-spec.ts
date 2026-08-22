import { BadRequestException } from '@nestjs/common';
import { LedgerAccountType, PrismaClient, RefundPspStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentEngineService } from '../src/modules/payments/payment-engine.service';
import { RefundEngineService } from '../src/modules/payments/refund-engine.service';
import { SANDBOX_REFUND_TRIGGERS } from '../src/modules/payments/sandbox-psp.adapter';
import { SettlementService } from '../src/modules/settlement/settlement.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * P0 finding, 2026-08-19 hardening pass (GitHub issue #28): `PspAdapter`
 * exposed `charge()` but no refund operation at all, and `RefundEngineService`
 * could — and did — post reversing ledger entries, claw back bonus, and mark
 * `Payment.refundedAmount`/`Refund` as complete without ever asking the
 * acquirer to move money. A refund could be "financially complete" inside
 * TuTak while the customer's card was never actually credited.
 *
 * This file is the regression suite for the fix: a `Refund` is now born
 * PENDING, the acquirer is genuinely asked, and the ledger/clawback effects
 * that imply money moved are applied only once the acquirer confirms it —
 * synchronously, or later via `reconcilePendingRefunds()`.
 */
describe('RefundEngineService — PSP confirmation boundary (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let payments: PaymentEngineService;
  let refunds: RefundEngineService;
  let settlement: SettlementService;
  let ledger: LedgerService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    payments = harness.app.get(PaymentEngineService);
    refunds = harness.app.get(RefundEngineService);
    settlement = harness.app.get(SettlementService);
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const capture = async (userId: string, partnerId: string, amount: string, key: string) =>
    payments.capture({
      userId,
      partnerId,
      amount,
      sourceToken: 'tok_visa_test',
      idempotencyKey: key,
    });

  const balanceOf = async (type: LedgerAccountType, partnerId?: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: partnerId ?? null },
    });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  const assertLedgerIntegrity = async () => {
    for (const account of await prisma.ledgerAccount.findMany()) {
      const replayed = await ledger.replayBalance(account.id);
      expect({ id: account.id, balance: account.balance.toFixed(4) }).toEqual({
        id: account.id,
        balance: replayed.toFixed(4),
      });
    }
  };

  // ── The refund is not real until the PSP confirms it ──────────────────

  it('a successful full refund is CONFIRMED and carries a real PSP reference', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-confirm-full');

    const result = await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'customer changed their mind',
      actorId: 'admin-1',
      idempotencyKey: 'refund-confirm-full-1',
    });

    expect(result.pspStatus).toBe(RefundPspStatus.CONFIRMED);
    const row = await prisma.refund.findUniqueOrThrow({ where: { id: result.refundId } });
    expect(row.pspStatus).toBe(RefundPspStatus.CONFIRMED);
    expect(row.pspRefundReference).toMatch(/^sandbox_refund_/);
    expect(row.ledgerTransactionId).not.toBeNull();
    await assertLedgerIntegrity();
  });

  it('a successful partial refund is CONFIRMED with the same accounting as before', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-confirm-partial');

    const result = await refunds.refund({
      paymentId: payment.paymentId,
      amount: '5000',
      reason: 'partial return',
      actorId: 'admin-1',
      idempotencyKey: 'refund-confirm-partial-1',
    });

    expect(result.pspStatus).toBe(RefundPspStatus.CONFIRMED);
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('5000.0000');
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('-4875.0000');
    expect(await balanceOf(LedgerAccountType.PLATFORM_REVENUE)).toBe('-125.0000');
    await assertLedgerIntegrity();
  });

  // ── PSP decline ─────────────────────────────────────────────────────────

  it('a PSP-declined refund releases the claim, leaves the row FAILED, and posts nothing', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-psp-decline');
    await settlement.settlePayment(payment.paymentId);
    const earnedBefore = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

    await expect(
      refunds.refund({
        paymentId: payment.paymentId,
        reason: `${SANDBOX_REFUND_TRIGGERS.DECLINE}: acquirer refused`,
        actorId: 'admin-1',
        idempotencyKey: 'refund-psp-decline-1',
      }),
    ).rejects.toThrow(BadRequestException);

    // The claim against refundedAmount must be released — the amount is
    // refundable again, not permanently stuck behind a refund that never
    // happened.
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(paymentAfter.refundedAmount.toFixed(4)).toBe('0.0000');

    const row = await prisma.refund.findFirstOrThrow({ where: { paymentId: payment.paymentId } });
    expect(row.pspStatus).toBe(RefundPspStatus.FAILED);
    expect(row.pspDeclineReason).toBe('sandbox_refund_declined');
    expect(row.ledgerTransactionId).toBeNull();
    expect(row.bonusClawedBack.toFixed(4)).toBe('0.0000');

    // Nothing moved: no reversing posting, no clawback.
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('10000.0000');
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.availableBonus.plus(walletAfter.pendingBonus).toFixed(4)).toBe(
      earnedBefore.availableBonus.plus(earnedBefore.pendingBonus).toFixed(4),
    );
    await assertLedgerIntegrity();

    // A declined refund is refundable again — the platform did not silently
    // consume the customer's entitlement to a real refund attempt.
    const retried = await refunds.refund({
      paymentId: payment.paymentId,
      reason: 'trying again with a real reason',
      actorId: 'admin-1',
      idempotencyKey: 'refund-psp-decline-retry-1',
    });
    expect(retried.pspStatus).toBe(RefundPspStatus.CONFIRMED);
  });

  it('replaying the exact same declined request keeps failing the same way, not silently succeeding', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '1000', 'pay-psp-decline-replay');

    const attempt = () =>
      refunds.refund({
        paymentId: payment.paymentId,
        reason: `${SANDBOX_REFUND_TRIGGERS.DECLINE}: card blocked`,
        actorId: 'admin-1',
        idempotencyKey: 'refund-psp-decline-replay-1',
      });

    await expect(attempt()).rejects.toThrow(BadRequestException);
    // The IdempotencyRecord was deleted on the first throw (IdempotencyService's
    // own behaviour), so this replay re-enters executeRefund and must find the
    // persisted FAILED Refund row rather than re-claiming or re-declaring success.
    await expect(attempt()).rejects.toThrow(BadRequestException);

    expect(await prisma.refund.count({ where: { paymentId: payment.paymentId } })).toBe(1);
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(paymentAfter.refundedAmount.toFixed(4)).toBe('0.0000');
  });

  // ── PSP timeout / unknown outcome ───────────────────────────────────────

  it('a PSP timeout leaves the refund PENDING — claimed, but not reported as money moved', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-psp-timeout');
    await settlement.settlePayment(payment.paymentId);
    const earnedBefore = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

    const result = await refunds.refund({
      paymentId: payment.paymentId,
      reason: `${SANDBOX_REFUND_TRIGGERS.UNREACHABLE}: acquirer unreachable`,
      actorId: 'admin-1',
      idempotencyKey: 'refund-psp-timeout-1',
    });

    // Not thrown — a timeout is ambiguous, not a definitive failure — but
    // must not be reported as complete either.
    expect(result.pspStatus).toBe(RefundPspStatus.PENDING);
    expect(result.bonusClawedBack).toBe('0.0000');

    // The claim holds: the acquirer may have processed it regardless of
    // whether this process found out, so the amount stays reserved.
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(paymentAfter.refundedAmount.toFixed(4)).toBe('10000.0000');

    // But nothing that implies confirmed money movement has happened yet.
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('10000.0000');
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletAfter.availableBonus.plus(walletAfter.pendingBonus).toFixed(4)).toBe(
      earnedBefore.availableBonus.plus(earnedBefore.pendingBonus).toFixed(4),
    );

    const row = await prisma.refund.findUniqueOrThrow({ where: { id: result.refundId } });
    expect(row.pspStatus).toBe(RefundPspStatus.PENDING);
    expect(row.ledgerTransactionId).toBeNull();
  });

  it('reconcilePendingRefunds() resolves a PENDING refund the acquirer later confirms, and only then applies the effects', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-psp-reconcile-confirm');
    await settlement.settlePayment(payment.paymentId);

    const submitted = await refunds.refund({
      paymentId: payment.paymentId,
      reason: `${SANDBOX_REFUND_TRIGGERS.PENDING_THEN_CONFIRMED}: async acquirer`,
      actorId: 'admin-1',
      idempotencyKey: 'refund-psp-reconcile-confirm-1',
    });
    expect(submitted.pspStatus).toBe(RefundPspStatus.PENDING);

    // Nothing applied yet.
    let walletNow = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletNow.availableBonus.plus(walletNow.pendingBonus).toFixed(4)).toBe('500.0000');

    const resolved = await refunds.reconcilePendingRefunds();
    expect(resolved).toBe(1);

    const row = await prisma.refund.findUniqueOrThrow({ where: { id: submitted.refundId } });
    expect(row.pspStatus).toBe(RefundPspStatus.CONFIRMED);
    expect(row.pspRefundReference).toMatch(/^sandbox_refund_/);
    expect(row.ledgerTransactionId).not.toBeNull();
    expect(row.bonusClawedBack.toFixed(4)).toBe('500.0000');

    walletNow = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletNow.availableBonus.plus(walletNow.pendingBonus).toFixed(4)).toBe('0.0000');
    await assertLedgerIntegrity();

    // Idempotent: reconciling again finds nothing left PENDING.
    expect(await refunds.reconcilePendingRefunds()).toBe(0);
  });

  it('reconcilePendingRefunds() resolves a PENDING refund the acquirer later declines, releasing the claim', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-psp-reconcile-decline');

    const submitted = await refunds.refund({
      paymentId: payment.paymentId,
      reason: `${SANDBOX_REFUND_TRIGGERS.PENDING_THEN_DECLINED}: async acquirer`,
      actorId: 'admin-1',
      idempotencyKey: 'refund-psp-reconcile-decline-1',
    });
    expect(submitted.pspStatus).toBe(RefundPspStatus.PENDING);

    const resolved = await refunds.reconcilePendingRefunds();
    expect(resolved).toBe(1);

    const row = await prisma.refund.findUniqueOrThrow({ where: { id: submitted.refundId } });
    expect(row.pspStatus).toBe(RefundPspStatus.FAILED);
    expect(row.ledgerTransactionId).toBeNull();

    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(paymentAfter.refundedAmount.toFixed(4)).toBe('0.0000');
    await assertLedgerIntegrity();
  });

  it('reconcilePendingRefunds() leaves a genuinely still-ambiguous refund PENDING rather than guessing', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-psp-reconcile-unresolved');

    const submitted = await refunds.refund({
      paymentId: payment.paymentId,
      reason: `${SANDBOX_REFUND_TRIGGERS.PENDING_FOREVER}: acquirer still processing`,
      actorId: 'admin-1',
      idempotencyKey: 'refund-psp-reconcile-unresolved-1',
    });
    expect(submitted.pspStatus).toBe(RefundPspStatus.PENDING);

    expect(await refunds.reconcilePendingRefunds()).toBe(0);

    const row = await prisma.refund.findUniqueOrThrow({ where: { id: submitted.refundId } });
    expect(row.pspStatus).toBe(RefundPspStatus.PENDING);
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(paymentAfter.refundedAmount.toFixed(4)).toBe('10000.0000'); // still reserved
  });

  // ── PSP success + local DB failure ─────────────────────────────────────

  it('recovers from a local failure after the PSP already confirmed the refund, via reconciliation — never double-applying the effects', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const payment = await capture(user.id, partner.id, '10000', 'pay-psp-local-crash');
    await settlement.settlePayment(payment.paymentId);

    // The PSP call itself (the default, no-marker path) succeeds
    // synchronously and the sandbox "acquirer" genuinely remembers it as
    // confirmed — but the *local* finalize transaction (ledger post +
    // Refund.update) is about to fail, simulating a crash between the PSP
    // answering and this process committing that answer.
    const postSpy = jest
      .spyOn(ledger, 'post')
      .mockImplementationOnce(() => Promise.reject(new Error('simulated local db failure')));

    await expect(
      refunds.refund({
        paymentId: payment.paymentId,
        reason: 'ordinary refund, PSP says yes, our own DB then falls over',
        actorId: 'admin-1',
        idempotencyKey: 'refund-psp-local-crash-1',
      }),
    ).rejects.toThrow('simulated local db failure');
    postSpy.mockRestore();

    // The operator's request failed — but the claim and the durable PENDING
    // row survived (they were committed before the PSP was ever called),
    // and the acquirer already has this refund confirmed.
    const stuck = await prisma.refund.findFirstOrThrow({ where: { paymentId: payment.paymentId } });
    expect(stuck.pspStatus).toBe(RefundPspStatus.PENDING);
    expect(stuck.ledgerTransactionId).toBeNull();
    const walletStuck = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletStuck.availableBonus.plus(walletStuck.pendingBonus).toFixed(4)).toBe('500.0000'); // not clawed back yet

    // Reconciliation is what makes this safe: it asks the PSP again (not a
    // new refund — a status check on the same idempotency key), finds the
    // acquirer's own record says CONFIRMED, and finalizes exactly once.
    const resolved = await refunds.reconcilePendingRefunds();
    expect(resolved).toBe(1);

    const finalRow = await prisma.refund.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(finalRow.pspStatus).toBe(RefundPspStatus.CONFIRMED);
    expect(finalRow.ledgerTransactionId).not.toBeNull();
    expect(finalRow.bonusClawedBack.toFixed(4)).toBe('500.0000');

    const walletFinal = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(walletFinal.availableBonus.plus(walletFinal.pendingBonus).toFixed(4)).toBe('0.0000');
    expect(await prisma.refund.count({ where: { paymentId: payment.paymentId } })).toBe(1); // never duplicated
    await assertLedgerIntegrity();
  });

  // ── Duplicate / concurrent requests, and the cumulative cap ─────────────

  it('a duplicate operator request for a PENDING refund does not call the PSP again', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '10000', 'pay-psp-dup-pending');
    const key = 'refund-psp-dup-pending-1';

    // A partial amount, deliberately: an omitted (implicit "full remaining")
    // amount hits a separate, pre-existing latent quirk in refund()'s
    // top-level bounds check — after the first claim, `remaining` becomes 0
    // and a same-key replay is rejected as "already refunded in full" before
    // ever reaching the idempotency layer, rather than replaying. That is
    // not part of this PSP-confirmation fix; recorded separately in the
    // audit report as a pre-existing LOW finding, not fixed here.
    const first = await refunds.refund({
      paymentId: payment.paymentId,
      amount: '4000',
      reason: `${SANDBOX_REFUND_TRIGGERS.PENDING_FOREVER}: still processing`,
      actorId: 'admin-1',
      idempotencyKey: key,
    });
    expect(first.pspStatus).toBe(RefundPspStatus.PENDING);

    // Force the idempotency record's own cache out of the way so this
    // replay is forced through executeRefund's findByKey fallback rather
    // than IdempotencyService's short-circuit — the harder path to get
    // right, and the one a crash between the two tables produces.
    await prisma.idempotencyRecord.deleteMany({ where: { key } });

    const second = await refunds.refund({
      paymentId: payment.paymentId,
      amount: '4000',
      reason: `${SANDBOX_REFUND_TRIGGERS.PENDING_FOREVER}: still processing`,
      actorId: 'admin-1',
      idempotencyKey: key,
    });

    expect(second.refundId).toBe(first.refundId);
    expect(second.pspStatus).toBe(RefundPspStatus.PENDING);
    expect(await prisma.refund.count({ where: { paymentId: payment.paymentId } })).toBe(1);
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(paymentAfter.refundedAmount.toFixed(4)).toBe('4000.0000'); // claimed once, not twice
  });

  it('never lets concurrent duplicate refund attempts together exceed the captured amount, PSP-backed or not', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '1000', 'pay-psp-race');

    const results = await Promise.allSettled([
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '1000',
        reason: 'a',
        actorId: 'admin-1',
        idempotencyKey: 'refund-psp-race-a',
      }),
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '1000',
        reason: 'b',
        actorId: 'admin-2',
        idempotencyKey: 'refund-psp-race-b',
      }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(stored.refundedAmount.toFixed(4)).toBe('1000.0000');
    expect(await prisma.refund.count({ where: { paymentId: payment.paymentId } })).toBe(1);
    await assertLedgerIntegrity();
  });

  it('a claim held by a PENDING refund counts toward the captured-amount cap, blocking a second refund that would overrun it', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const payment = await capture(user.id, partner.id, '1000', 'pay-psp-pending-caps');

    const pending = await refunds.refund({
      paymentId: payment.paymentId,
      amount: '700',
      reason: `${SANDBOX_REFUND_TRIGGERS.PENDING_FOREVER}: still processing`,
      actorId: 'admin-1',
      idempotencyKey: 'refund-psp-pending-caps-1',
    });
    expect(pending.pspStatus).toBe(RefundPspStatus.PENDING);

    // Only 300 remains refundable while 700 is claimed by the still-pending
    // refund above — an amount the PSP may or may not have already moved.
    await expect(
      refunds.refund({
        paymentId: payment.paymentId,
        amount: '400',
        reason: 'second refund attempt',
        actorId: 'admin-1',
        idempotencyKey: 'refund-psp-pending-caps-2',
      }),
    ).rejects.toThrow(BadRequestException);

    const within = await refunds.refund({
      paymentId: payment.paymentId,
      amount: '300',
      reason: 'fits in what remains',
      actorId: 'admin-1',
      idempotencyKey: 'refund-psp-pending-caps-3',
    });
    expect(within.pspStatus).toBe(RefundPspStatus.CONFIRMED);

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.paymentId } });
    expect(stored.refundedAmount.toFixed(4)).toBe('1000.0000');
  });
});
