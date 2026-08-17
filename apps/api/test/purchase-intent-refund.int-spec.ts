import { BadRequestException } from '@nestjs/common';
import { BonusEntryType, BonusLotStatus, DeferredBonusLotStatus, PrismaClient, RoleName } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../src/modules/wallet/deferred-bonus-lot.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * `PurchaseIntentRefundService` — the transaction-linked TuTak refund that
 * replaces the PSP-style refund concept for ordinary purchases. A partner
 * enters only the merchandise refund amount; TuTak never moves real money
 * here (the partner repays the customer outside TuTak) and instead reverses,
 * proportionally, every loyalty effect the original confirmation created.
 */
describe('PurchaseIntentRefundService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let refunds: PurchaseIntentRefundService;
  let engine: BonusEngineService;
  let deferredLots: DeferredBonusLotService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    refunds = harness.app.get(PurchaseIntentRefundService);
    engine = harness.app.get(BonusEngineService);
    deferredLots = harness.app.get(DeferredBonusLotService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const staffMember = async (partnerId: string) => {
    const { user } = await createCustomer(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.PARTNER_OWNER } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, partnerId } });
    return user;
  };

  /** A confirmed purchase at 5% (pool 500 on a 10000 gross): green 100, deferred 150, tutak 150. */
  const confirmedPurchase = async (params: { bonusAmountRequested?: string } = {}) => {
    const { user, wallet } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const staff = await staffMember(partner.id);

    if (params.bonusAmountRequested) {
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: params.bonusAmountRequested,
        pendingHours: 0,
      });
    }

    const intent = await purchaseIntents.create(
      {
        partnerId: partner.id,
        grossAmount: '10000',
        bonusAmountRequested: params.bonusAmountRequested,
      },
      user.id,
    );
    const confirmed = await purchaseIntents.confirm(intent.id, staff.id);
    return { user, wallet, partner, staff, intent: confirmed };
  };

  // ── Full and partial refunds ────────────────────────────────────────────

  it('reverses the full purchase accrual, deferred lot, and ledger on a full refund', async () => {
    const { wallet, partner, staff, intent } = await confirmedPurchase();

    const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(before.availableBonus.toFixed(4)).toBe('100.0000'); // green

    const result = await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'customer returned item',
      actorId: staff.id,
      idempotencyKey: 'refund-full-1',
    });

    expect(result.amount).toBe('10000.0000');
    expect(result.totalRefunded).toBe('10000.0000');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');

    const lot = await prisma.deferredBonusLot.findFirstOrThrow({
      where: { sourceTransactionId: intent.sourceTransactionId! },
    });
    expect(lot.amount.toFixed(4)).toBe('150.0000'); // immutable original grant
    expect(lot.refundedAmount.toFixed(4)).toBe('150.0000'); // fully reversed
    expect(lot.status).toBe(DeferredBonusLotStatus.DEFERRED); // never reduced to zero via expiry — still open

    const refreshedIntent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(refreshedIntent.refundedAmount.toFixed(4)).toBe('10000.0000');

    // The ledger nets exactly back to zero — nothing left over from either side.
    const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
    const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
    expect(partnerAccount.balance.toFixed(4)).toBe('0.0000');
    expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('0.0000');
    expect(revenueAccount.balance.toFixed(4)).toBe('0.0000');

    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('restores proportionally on a partial refund', async () => {
    const { wallet, intent } = await confirmedPurchase();

    // Half the merchandise: half of green (100 -> 50) and half of deferred (150 -> 75).
    const result = await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '5000',
      reason: 'partial return',
      actorId: (await staffMember(intent.partnerId)).id,
      idempotencyKey: 'refund-partial-1',
    });

    expect(result.amount).toBe('5000.0000');
    expect(result.totalRefunded).toBe('5000.0000');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('50.0000');

    const lot = await prisma.deferredBonusLot.findFirstOrThrow({
      where: { sourceTransactionId: intent.sourceTransactionId! },
    });
    expect(lot.refundedAmount.toFixed(4)).toBe('75.0000');

    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('restores the customer-spent bonus (the discount) on a full refund', async () => {
    const { wallet, partner, staff, intent } = await confirmedPurchase({ bonusAmountRequested: '4000' });

    const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // 4000 spent, green 100 earned back on the cash portion's own pool math
    // (pool is computed off the full gross, not the post-bonus remainder).
    expect(before.availableBonus.toFixed(4)).toBe('100.0000');
    expect(before.lifetimeSpent.toFixed(4)).toBe('4000.0000');

    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'full return',
      actorId: staff.id,
      idempotencyKey: 'refund-spent-bonus-1',
    });

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // The 4000 spent is restored on top of the (now clawed-back) green share.
    expect(after.availableBonus.toFixed(4)).toBe('4000.0000');
    expect(after.lifetimeSpent.toFixed(4)).toBe('0.0000');

    const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
    expect(partnerAccount.balance.toFixed(4)).toBe('0.0000');
    expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('0.0000');

    await assertWalletIntegrity(prisma, wallet.id);
  });

  // ── Idempotency and cumulative bounds ───────────────────────────────────

  it('is idempotent — replaying the same key returns the same result without a second effect', async () => {
    const { wallet, staff, intent } = await confirmedPurchase();

    const first = await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '3000',
      reason: 'return',
      actorId: staff.id,
      idempotencyKey: 'replay-key-1',
    });
    const second = await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '3000',
      reason: 'return',
      actorId: staff.id,
      idempotencyKey: 'replay-key-1',
    });

    expect(second).toEqual(first);
    expect(await prisma.purchaseIntentRefund.count({ where: { purchaseIntentId: intent.id } })).toBe(1);

    const refreshedIntent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(refreshedIntent.refundedAmount.toFixed(4)).toBe('3000.0000'); // not 6000

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // 30% of the 100 green share, once — not twice.
    expect(after.availableBonus.toFixed(4)).toBe('70.0000');
  });

  it('lets multiple partial refunds accumulate to the full amount, and refuses more', async () => {
    const { wallet, staff, intent } = await confirmedPurchase();

    await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '4000',
      reason: 'return 1',
      actorId: staff.id,
      idempotencyKey: 'cumulative-1',
    });
    const second = await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '6000',
      reason: 'return 2',
      actorId: staff.id,
      idempotencyKey: 'cumulative-2',
    });

    expect(second.totalRefunded).toBe('10000.0000');

    // Exactly the full green share clawed back — no residue from rounding
    // across the two independent partial computations.
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');

    await expect(
      refunds.refund({
        purchaseIntentId: intent.id,
        amount: '0.01',
        reason: 'return 3',
        actorId: staff.id,
        idempotencyKey: 'cumulative-3',
      }),
    ).rejects.toThrow(/already been refunded in full/);

    await assertWalletIntegrity(prisma, wallet.id);
  });

  it('refuses a single refund larger than what remains on the purchase', async () => {
    const { staff, intent } = await confirmedPurchase();

    await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '7000',
      reason: 'return',
      actorId: staff.id,
      idempotencyKey: 'over-refund-1',
    });

    await expect(
      refunds.refund({
        purchaseIntentId: intent.id,
        amount: '5000', // only 3000 remains
        reason: 'return',
        actorId: staff.id,
        idempotencyKey: 'over-refund-2',
      }),
    ).rejects.toThrow(/exceeds the/);
  });

  it('refuses to refund a purchase that was never confirmed', async () => {
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const staff = await staffMember(partner.id);
    const intent = await purchaseIntents.create({ partnerId: partner.id, grossAmount: '10000' }, user.id);

    await expect(
      refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'return',
        actorId: staff.id,
        idempotencyKey: 'unconfirmed-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── Already-spent earned bonus ──────────────────────────────────────────

  it('claws back only what remains when the earned bonus was already spent', async () => {
    const { wallet, staff, intent } = await confirmedPurchase();

    // Spend the green 100 the purchase just earned, in full, before refunding.
    const reservation = await engine.reserve(wallet.id, '100', 'spend-before-refund');
    await engine.settleReservation(reservation.reservationId);

    const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(before.availableBonus.toFixed(4)).toBe('0.0000');

    // Refunding must not throw and must not drive the wallet negative — the
    // shortfall is absorbed, exactly like `reverseAccrualLot` already does
    // for the PSP-style refund path.
    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'return after spend',
      actorId: staff.id,
      idempotencyKey: 'already-spent-1',
    });

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.isNegative()).toBe(false);
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');

    const greenLot = await prisma.bonusLot.findFirstOrThrow({
      where: { sourceTransactionId: intent.sourceTransactionId!, type: BonusEntryType.ACCRUAL_PURCHASE },
    });
    expect(greenLot.remainingAmount.toFixed(4)).toBe('0.0000');
    expect(greenLot.status).toBe(BonusLotStatus.CONSUMED);

    await assertWalletIntegrity(prisma, wallet.id);
  });

  // ── Referral and deferred reversal ──────────────────────────────────────

  it('reverses the referrer share together with the purchase accrual and the deferred lot', async () => {
    const referrer = await createCustomer(prisma);
    await prisma.referralCode.create({ data: { userId: referrer.user.id, code: 'TT-REFUND1' } });
    const { user: referee, wallet: refereeWallet } = await createCustomer(prisma);
    await prisma.referralInvite.create({
      data: { referrerType: 'USER', referrerUserId: referrer.user.id, refereeUserId: referee.id },
    });

    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const staff = await staffMember(partner.id);
    const intent = await purchaseIntents.create({ partnerId: partner.id, grossAmount: '10000' }, referee.id);
    const confirmed = await purchaseIntents.confirm(intent.id, staff.id);

    const referrerWalletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.user.id } });
    expect(referrerWalletBefore.availableBonus.toFixed(4)).toBe('100.0000');

    await refunds.refund({
      purchaseIntentId: confirmed.id,
      reason: 'full return',
      actorId: staff.id,
      idempotencyKey: 'referral-deferred-1',
    });

    const referrerWalletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.user.id } });
    expect(referrerWalletAfter.availableBonus.toFixed(4)).toBe('0.0000');

    const refereeWalletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: refereeWallet.id } });
    expect(refereeWalletAfter.availableBonus.toFixed(4)).toBe('0.0000');

    const lot = await prisma.deferredBonusLot.findFirstOrThrow({
      where: { sourceTransactionId: confirmed.sourceTransactionId! },
    });
    expect(lot.refundedAmount.toFixed(4)).toBe('150.0000');

    // customerLiability (green 100 + deferred 150 + referrer 100) is fully
    // reversed; only the referrerless remainder never existed here, so
    // revenue (tutak base 150) also nets back to zero.
    const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
    const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
    expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('0.0000');
    expect(revenueAccount.balance.toFixed(4)).toBe('0.0000');

    await assertWalletIntegrity(prisma, refereeWallet.id);
    await assertWalletIntegrity(prisma, referrerWalletBefore.id);
  });

  it('excludes an already-expired deferred lot from the liability reversal instead of double-debiting it', async () => {
    const { wallet, partner, staff, intent } = await confirmedPurchase();

    const lot = await prisma.deferredBonusLot.findFirstOrThrow({
      where: { sourceTransactionId: intent.sourceTransactionId! },
    });
    // Force the lot past its deadline and let it expire the way
    // `expireOverdueLots` normally would — releasing its BONUS_LIABILITY
    // share to PLATFORM_REVENUE.
    await prisma.deferredBonusLot.update({ where: { id: lot.id }, data: { deadline: new Date(Date.now() - 1000) } });
    await deferredLots.expireOverdueLots();

    const revenueBeforeRefund = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
    // No referrer, so confirmation already routed the 100 referrer share to
    // revenue alongside the 150 tutak base (-250); expiry adds the 150
    // deferred share on top: -400.
    expect(revenueBeforeRefund.balance.toFixed(4)).toBe('-400.0000');

    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'return after deferred lot expired',
      actorId: staff.id,
      idempotencyKey: 'expired-deferred-1',
    });

    const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
    // Only green (100) was ever an outstanding liability by refund time —
    // debiting it fully back to zero proves the expired deferred share was
    // excluded rather than debited a second time.
    expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('0.0000');

    const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    expect(partnerAccount.balance.toFixed(4)).toBe('0.0000');

    const refreshedLot = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(refreshedLot.status).toBe(DeferredBonusLotStatus.EXPIRED);
    expect(refreshedLot.amount.toFixed(4)).toBe('150.0000'); // untouched — closed history

    await assertWalletIntegrity(prisma, wallet.id);
  });

  // ── Ledger balance ───────────────────────────────────────────────────────

  it('records a balanced reversing ledger transaction distinct from the original', async () => {
    const { partner, staff, intent } = await confirmedPurchase({ bonusAmountRequested: '2000' });

    await refunds.refund({
      purchaseIntentId: intent.id,
      amount: '5000',
      reason: 'partial return',
      actorId: staff.id,
      idempotencyKey: 'ledger-balance-1',
    });

    const contributionRefund = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: 'partner.contribution_refund', sourceType: 'PurchaseIntent', sourceId: intent.id },
      include: { postings: true },
    });
    const compensationRefund = await prisma.ledgerTransaction.findFirstOrThrow({
      where: {
        kind: 'partner.bonus_redemption_compensation_refund',
        sourceType: 'PurchaseIntent',
        sourceId: intent.id,
      },
      include: { postings: true },
    });

    const signedSum = (postings: { direction: string; amount: Decimal }[]) =>
      postings.reduce(
        (acc, p) => acc.plus(p.direction === 'DEBIT' ? p.amount : p.amount.negated()),
        new Decimal(0),
      );
    expect(signedSum(contributionRefund.postings).toFixed(4)).toBe('0.0000');
    expect(signedSum(compensationRefund.postings).toFixed(4)).toBe('0.0000');

    // Distinct from the original confirmation's own two postings — a refund
    // is a new transaction, never an edit of the original.
    const allForIntent = await prisma.ledgerTransaction.count({
      where: { sourceType: 'PurchaseIntent', sourceId: intent.id },
    });
    expect(allForIntent).toBe(4); // 2 original + 2 reversal
    expect(partner.id).toBeTruthy();
  });
});
