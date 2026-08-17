import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BonusEntryType,
  BonusLotStatus,
  DeferredBonusLotStatus,
  PrismaClient,
  ReferralChallengeParticipantStatus,
  ReferrerType,
  RoleName,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PurchaseIntentRefundService } from '../src/modules/purchase-intents/purchase-intent-refund.service';
import { PurchaseIntentsService } from '../src/modules/purchase-intents/purchase-intents.service';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../src/modules/wallet/deferred-bonus-lot.service';
import { ReferralService } from '../src/modules/referral/referral.service';
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
  let referral: ReferralService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    refunds = harness.app.get(PurchaseIntentRefundService);
    engine = harness.app.get(BonusEngineService);
    deferredLots = harness.app.get(DeferredBonusLotService);
    referral = harness.app.get(ReferralService);
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

  /** Same shape as `confirmedPurchase`, but for a caller-supplied customer and gross amount. */
  const confirmedPurchaseFor = async (userId: string, grossAmount: string) => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const staff = await staffMember(partner.id);
    const intent = await purchaseIntents.create({ partnerId: partner.id, grossAmount }, userId);
    const confirmed = await purchaseIntents.confirm(intent.id, staff.id);
    return { partner, staff, intent: confirmed };
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

  // ── Liability reversal must match what wallets actually gave back ──────

  it('debits BONUS_LIABILITY only for what was actually reclaimed from wallets, not the theoretical share', async () => {
    const { wallet, partner, staff, intent } = await confirmedPurchase();

    // Spend all 100 of the green share elsewhere before the purchase that
    // earned it is refunded — nothing is left in the lot to claw back.
    const reservation = await engine.reserve(wallet.id, '100', 'spend-before-refund');
    await engine.settleReservation(reservation.reservationId);

    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'return after full spend',
      actorId: staff.id,
      idempotencyKey: 'liability-actual-full-spend-1',
    });

    // Confirmation credited BONUS_LIABILITY 250 (green 100 + deferred 150;
    // no referrer here). Nothing was reclaimable from the green lot, so the
    // refund's own debit must be only the deferred share (150) — leaving
    // -100 outstanding, not 0. Pre-fix, the refund debited the full
    // theoretical 250 regardless of what wallets actually gave back, which
    // brings the balance to a deceptively "clean" 0 even though the green
    // 100 was never actually reclaimed — the bug this test catches.
    const contributionRefund = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: 'partner.contribution_refund', sourceType: 'PurchaseIntent', sourceId: intent.id },
      include: { postings: true },
    });
    const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
    const liabilityLeg = contributionRefund.postings.find((p) => p.accountId === bonusLiabilityAccount.id);
    expect(liabilityLeg?.amount.toFixed(4)).toBe('150.0000');
    expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('-100.0000');

    await assertWalletIntegrity(prisma, wallet.id);
    expect(partner.id).toBeTruthy();
  });

  it('debits BONUS_LIABILITY only for the unspent remainder when the green share was partly spent', async () => {
    const { wallet, intent, staff } = await confirmedPurchase();

    // Spend 40 of the 100 green share elsewhere; 60 remains reclaimable.
    const reservation = await engine.reserve(wallet.id, '40', 'partial-spend-before-refund');
    await engine.settleReservation(reservation.reservationId);

    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'return after partial spend',
      actorId: staff.id,
      idempotencyKey: 'liability-actual-partial-spend-1',
    });

    const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
    const contributionRefund = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: 'partner.contribution_refund', sourceType: 'PurchaseIntent', sourceId: intent.id },
      include: { postings: true },
    });
    const liabilityLeg = contributionRefund.postings.find((p) => p.accountId === bonusLiabilityAccount.id);
    // Confirmation credited BONUS_LIABILITY 250 (green 100 + deferred 150).
    // Only 60 of the green 100 was reclaimable (40 already spent) plus the
    // full untouched deferred 150 — 210, not the full theoretical 250 — so
    // the refund's own debit is 210 and the balance ends at -40, not 0.
    expect(liabilityLeg?.amount.toFixed(4)).toBe('210.0000');
    expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('-40.0000');

    await assertWalletIntegrity(prisma, wallet.id);
  });

  // ── Historical allocation, not live configuration ───────────────────────

  it('reverses the exact confirmed pool split even after the platform pool-split configuration changes', async () => {
    const { wallet, partner, staff, intent } = await confirmedPurchase();

    // Confirmed at 20/30/20/30 on a 500 pool: green 100, deferred 150.
    const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(before.availableBonus.toFixed(4)).toBe('100.0000');

    // The platform changes its pool-split policy after this purchase
    // already confirmed — green now 90% instead of 20%. Restored at the end
    // of the test: `config` is the single shared ConfigService instance for
    // this whole file's harness, so a mutation left in place here would leak
    // into every test that runs afterward for the rest of the file.
    const config = harness.app.get(ConfigService);
    const originalPoolGreenBps = config.get('purchasePolicy.poolGreenBps', { infer: true });
    config.set('purchasePolicy.poolGreenBps', 9000);

    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'full return after policy change',
      actorId: staff.id,
      idempotencyKey: 'historical-split-1',
    });

    // If the refund had recomputed from the *new* 90% green split, it would
    // try to claw back 450 (90% of the 500 pool) — far more than the 100
    // actually ever accrued, which `reverseAccrualLot` would silently cap
    // at the lot's own remainder anyway, masking the bug. The unambiguous
    // proof is the ledger: it must net back to exactly zero, which only
    // happens if the reversal used the original 20/30/20/30 amounts.
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.availableBonus.toFixed(4)).toBe('0.0000');

    const partnerAccount = await prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PARTNER_PAYABLE', partnerId: partner.id },
    });
    const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
    const revenueAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE' } });
    expect(partnerAccount.balance.toFixed(4)).toBe('0.0000');
    expect(bonusLiabilityAccount.balance.toFixed(4)).toBe('0.0000');
    expect(revenueAccount.balance.toFixed(4)).toBe('0.0000');

    const refreshedIntent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.id } });
    // The stored snapshot itself is untouched by the later config change.
    expect(refreshedIntent.greenAmount?.toFixed(4)).toBe('100.0000');

    await assertWalletIntegrity(prisma, wallet.id);
    config.set('purchasePolicy.poolGreenBps', originalPoolGreenBps);
  });

  // ── Refund attribution: deferred bonus lots (GitHub issue #28) ─────────

  it('reverses turnover contributed to another still-open deferred lot when the contributing purchase is refunded', async () => {
    const { user } = await createCustomer(prisma);
    const seedLot = await prisma.deferredBonusLot.create({
      data: {
        userId: user.id,
        sourceTransactionId: 'seed-lot-source-open',
        amount: '500',
        requiredTurnover: '20000',
        progressTurnover: '4000',
        deadline: new Date(Date.now() + 90 * 24 * 3600 * 1000),
      },
    });

    const { intent } = await confirmedPurchaseFor(user.id, '6000');

    const afterPurchase = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: seedLot.id } });
    expect(afterPurchase.progressTurnover.toFixed(4)).toBe('10000.0000'); // 4000 + 6000
    expect(afterPurchase.status).toBe(DeferredBonusLotStatus.DEFERRED);

    const staff = await staffMember(intent.partnerId);
    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'full return',
      actorId: staff.id,
      idempotencyKey: 'external-lot-reversal-1',
    });

    // The turnover this purchase lent to the *other* lot comes back out —
    // without this, buying just enough to push a stuck lot over its
    // threshold and then refunding kept the inflated progress forever
    // (independent audit, GitHub issue #28).
    const afterRefund = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: seedLot.id } });
    expect(afterRefund.progressTurnover.toFixed(4)).toBe('4000.0000');
    expect(afterRefund.status).toBe(DeferredBonusLotStatus.DEFERRED);

    const contribution = await prisma.deferredBonusLotContribution.findFirstOrThrow({
      where: { lotId: seedLot.id, sourceTransactionId: intent.sourceTransactionId! },
    });
    expect(contribution.amount.toFixed(4)).toBe('6000.0000');
    expect(contribution.reversedAmount.toFixed(4)).toBe('6000.0000');
  });

  it('does not reverse turnover on a deferred lot that has already unlocked using it', async () => {
    const { user, wallet } = await createCustomer(prisma);
    const seedLot = await prisma.deferredBonusLot.create({
      data: {
        userId: user.id,
        sourceTransactionId: 'seed-lot-source-unlocked',
        amount: '500',
        requiredTurnover: '5000',
        progressTurnover: '4900',
        deadline: new Date(Date.now() + 90 * 24 * 3600 * 1000),
      },
    });

    // 4900 + 200 = 5100 >= 5000: this purchase's own turnover contribution
    // is what pushes the *other* lot over its threshold and unlocks it.
    const { intent } = await confirmedPurchaseFor(user.id, '200');

    const unlockedLot = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: seedLot.id } });
    expect(unlockedLot.status).toBe(DeferredBonusLotStatus.AVAILABLE);
    expect(unlockedLot.progressTurnover.toFixed(4)).toBe('5100.0000');
    // The 500 AMD this lot granted, as its own distinct wallet-side lot —
    // tracked separately from the refunded purchase's own (unrelated) 2 AMD
    // green accrual, which the refund correctly does reverse.
    const grantedLot = await prisma.bonusLot.findUniqueOrThrow({
      where: { id: unlockedLot.grantedBonusLotId! },
    });
    expect(grantedLot.remainingAmount.toFixed(4)).toBe('500.0000');

    const staff = await staffMember(intent.partnerId);
    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'full return',
      actorId: staff.id,
      idempotencyKey: 'external-lot-no-reversal-1',
    });

    // Deliberately untouched: this lot already unlocked and granted a real,
    // spendable accrual funded by a *different* purchase's own settlement —
    // see `reverseExternalContributions`'s docblock for why safely clawing
    // that back is out of scope for this fix and reported as a residual.
    const afterRefund = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: seedLot.id } });
    expect(afterRefund.status).toBe(DeferredBonusLotStatus.AVAILABLE);
    expect(afterRefund.progressTurnover.toFixed(4)).toBe('5100.0000');

    const grantedLotAfter = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLot.id } });
    expect(grantedLotAfter.remainingAmount.toFixed(4)).toBe('500.0000');

    await assertWalletIntegrity(prisma, wallet.id);
  });

  // ── Refund attribution: Referral Challenge (GitHub issue #28) ──────────

  const invitedChallenge = async (requiredAmount = '10000') => {
    const { user: referrerUser } = await createCustomer(prisma);
    const { user: refereeUser } = await createCustomer(prisma);
    await prisma.referralInvite.create({
      data: {
        referrerType: ReferrerType.USER,
        referrerUserId: referrerUser.id,
        refereeUserId: refereeUser.id,
      },
    });
    const participant = await prisma.referralChallengeParticipant.create({
      data: { referrerUserId: referrerUser.id, refereeUserId: refereeUser.id, requiredAmount },
    });
    return { referrerUser, refereeUser, participant };
  };

  it('reverses referral challenge progress when the contributing purchase is refunded, so it cannot count toward qualification', async () => {
    const { refereeUser, participant } = await invitedChallenge('10000');

    const { intent } = await confirmedPurchaseFor(refereeUser.id, '6000');
    await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);

    const afterPurchase = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(afterPurchase.progressAmount.toFixed(4)).toBe('6000.0000');
    expect(afterPurchase.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);

    const staff = await staffMember(intent.partnerId);
    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'full return',
      actorId: staff.id,
      idempotencyKey: 'challenge-reversal-1',
    });

    const afterRefund = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(afterRefund.progressAmount.toFixed(4)).toBe('0.0000');
    expect(afterRefund.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);

    // The refunded purchase is truly gone from the tally, not just
    // temporarily offset: a second, smaller purchase alone must not
    // combine with the refunded 6000 to reach the 10000 threshold.
    const { intent: secondIntent } = await confirmedPurchaseFor(refereeUser.id, '4000');
    await referral.advanceChallengeProgress(refereeUser.id, secondIntent.sourceTransactionId!);
    const finalState = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(finalState.progressAmount.toFixed(4)).toBe('4000.0000');
    expect(finalState.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
  });

  it('reverses a QUALIFIED participant back to IN_PROGRESS when its qualifying purchase is refunded, closing the permanent-qualification gap', async () => {
    const { referrerUser, refereeUser, participant } = await invitedChallenge('10000');

    // Fill this referrer's 3 reward slots with other, already-REWARDED
    // participants, so this referee's own qualification cannot also
    // reward — deterministically reaching QUALIFIED-without-REWARDED
    // without needing three real purchases.
    for (let i = 0; i < 3; i += 1) {
      const { user: otherReferee } = await createCustomer(prisma);
      await prisma.referralChallengeParticipant.create({
        data: {
          referrerUserId: referrerUser.id,
          refereeUserId: otherReferee.id,
          requiredAmount: '10000',
          progressAmount: '10000',
          status: ReferralChallengeParticipantStatus.REWARDED,
          qualifiedAt: new Date(),
          rewardedAt: new Date(),
        },
      });
    }

    const { intent } = await confirmedPurchaseFor(refereeUser.id, '10000');
    await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);

    const qualified = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(qualified.status).toBe(ReferralChallengeParticipantStatus.QUALIFIED);
    expect(qualified.qualifiedAt).not.toBeNull();

    const staff = await staffMember(intent.partnerId);
    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'full return',
      actorId: staff.id,
      idempotencyKey: 'challenge-unqualify-1',
    });

    // Nothing was ever paid out for this participant (all 3 slots were
    // already taken), so un-qualifying it is fully safe — exactly what
    // "prevent a refunded purchase from permanently qualifying a referral
    // reward" requires.
    const reverted = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(reverted.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
    expect(reverted.progressAmount.toFixed(4)).toBe('0.0000');
    expect(reverted.qualifiedAt).toBeNull();
  });

  it('does not attempt to reclaim an already-paid referral challenge reward', async () => {
    const { refereeUser, participant } = await invitedChallenge('10000');

    const { intent } = await confirmedPurchaseFor(refereeUser.id, '10000');
    await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);

    const rewarded = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(rewarded.status).toBe(ReferralChallengeParticipantStatus.REWARDED);

    const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: refereeUser.id } });
    const rewardLot = await prisma.bonusLot.findFirstOrThrow({
      where: { walletId: refereeWallet.id, type: BonusEntryType.ACCRUAL_PROMOTION },
    });
    expect(rewardLot.remainingAmount.toFixed(4)).toBe('1000.0000');

    const staff = await staffMember(intent.partnerId);
    await refunds.refund({
      purchaseIntentId: intent.id,
      reason: 'full return',
      actorId: staff.id,
      idempotencyKey: 'challenge-rewarded-untouched-1',
    });

    // A REWARDED participant is a real, already-spendable wallet credit
    // funded from TuTak's own funds — this fix does not attempt to claw it
    // back (see `reverseChallengeContribution`'s docblock).
    const after = await prisma.referralChallengeParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(after.status).toBe(ReferralChallengeParticipantStatus.REWARDED);
    expect(after.progressAmount.toFixed(4)).toBe('10000.0000');

    const rewardLotAfter = await prisma.bonusLot.findUniqueOrThrow({ where: { id: rewardLot.id } });
    expect(rewardLotAfter.remainingAmount.toFixed(4)).toBe('1000.0000');
  });
});
