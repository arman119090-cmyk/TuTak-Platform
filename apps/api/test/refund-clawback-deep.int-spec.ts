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
import { ReferralService } from '../src/modules/referral/referral.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * The deeper matrix for the two refund-attribution clawbacks added on top of
 * `PurchaseIntentRefundService` — partially/fully spent grants, idempotent
 * and concurrent refunds, and the Referral Challenge's first-3-slot
 * bookkeeping — split out from `purchase-intent-refund.int-spec.ts`'s own
 * happy-path coverage of the same two mechanisms (independent audit, GitHub
 * issue #28).
 */
describe('Refund clawback — deep matrix (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let purchaseIntents: PurchaseIntentsService;
  let refunds: PurchaseIntentRefundService;
  let engine: BonusEngineService;
  let referral: ReferralService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    purchaseIntents = harness.app.get(PurchaseIntentsService);
    refunds = harness.app.get(PurchaseIntentRefundService);
    engine = harness.app.get(BonusEngineService);
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

  const confirmedPurchaseFor = async (userId: string, grossAmount: string) => {
    const partner = await createPartner(prisma, { bonusAccrualRateBps: 500 });
    const staff = await staffMember(partner.id);
    const intent = await purchaseIntents.create({ partnerId: partner.id, grossAmount }, userId);
    const confirmed = await purchaseIntents.confirm(intent.id, staff.id);
    return { partner, staff, intent: confirmed };
  };

  /** Spends `amount` of a wallet's single AVAILABLE lot via reserve+settle. */
  const spend = async (walletId: string, amount: string, sourceTransactionId: string) => {
    const { reservationId } = await engine.reserve(walletId, amount, sourceTransactionId);
    await engine.settleReservation(reservationId);
  };

  /**
   * `bonusAccrualRateBps` now has an enforced non-zero floor (the
   * `partners_commission_rate_on_grid` rate-card constraint), so every real
   * purchase creates at least a small green-accrual lot of its own alongside
   * whatever deferred/reward lot is under test in the same wallet.
   * `BonusEngineService.reserve` always draws the oldest-*expiring* AVAILABLE
   * lot first, so a test that needs to spend precisely against *one* known
   * lot pushes every other AVAILABLE lot in the wallet's `expiresAt` far out
   * first — deterministic isolation without needing a since-removed
   * zero-rate partner (independent audit, GitHub issue #28).
   */
  const isolateForSpend = async (walletId: string, keepLotId: string) => {
    await prisma.bonusLot.updateMany({
      where: { walletId, id: { not: keepLotId }, status: BonusLotStatus.AVAILABLE },
      data: { expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000) },
    });
  };

  // ── Item 1: DeferredBonusLot unlock reversal ────────────────────────────

  describe('deferred bonus lot unlock reversal', () => {
    const seedLot = (userId: string, progressTurnover: string) =>
      prisma.deferredBonusLot.create({
        data: {
          userId,
          sourceTransactionId: `seed-${userId}`,
          amount: '500',
          requiredTurnover: '5000',
          progressTurnover,
          deadline: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        },
      });

    it('claws back only the unspent remainder when the unlocked grant was partially spent, and writes off the shortfall', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      // Contributes 200 turnover, unlocking the lot at 4900+200=5100. Also
      // creates its own small green-accrual lot in the same wallet, isolated
      // out below so the spend below draws only from the grant under test.
      const { intent } = await confirmedPurchaseFor(user.id, '200');

      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;
      await isolateForSpend(wallet.id, grantedLotId);
      await spend(wallet.id, '300', 'spend-1'); // 300 of the 500 spent, 200 left

      const staff = await staffMember(intent.partnerId);
      await refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'full return',
        actorId: staff.id,
        idempotencyKey: 'partial-spend-clawback-1',
      });

      const afterRefund = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterRefund.progressTurnover.toFixed(4)).toBe('4900.0000');
      // This clawback came via `reverseUnlock` (an *external* contributing
      // purchase dropping turnover below threshold) — the lot's *own*
      // purchase-refund path (`refundedAmount`) is untouched, and the lot
      // reverts to DEFERRED so it can requalify: only the genuinely
      // unrecoverable (already spent) 300 is permanently forfeited, never
      // the 200 that was still sitting unspent and successfully reclaimed.
      expect(afterRefund.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterRefund.refundedAmount.toFixed(4)).toBe('0.0000');
      expect(afterRefund.forfeitedAmount.toFixed(4)).toBe('300.0000');
      expect(afterRefund.grantedBonusLotId).toBeNull();

      const grantedLotAfter = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLotId } });
      expect(grantedLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');
      // The wallet never goes negative: only the 200 still sitting unspent
      // was ever reclaimable.
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.isNegative()).toBe(false);

      const ledgerTx = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'deferred_bonus.unlock_reversed', sourceId: lot.id },
        include: { postings: true },
      });
      const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
      const liabilityLeg = ledgerTx.postings.find((p) => p.accountId === bonusLiabilityAccount.id);
      // Only the 300 actually forfeited (spent, unrecoverable) is released
      // to revenue — never the 200 that was reclaimed and returned to
      // ordinary outstanding liability, available to grant again.
      expect(liabilityLeg?.amount.toFixed(4)).toBe('300.0000');

      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('writes off the full shortfall with no wallet clawback when the unlocked grant was fully spent', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      const { intent } = await confirmedPurchaseFor(user.id, '200');
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;
      await isolateForSpend(wallet.id, grantedLotId);
      await spend(wallet.id, '500', 'spend-full-1'); // the entire grant

      const staff = await staffMember(intent.partnerId);
      await refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'full return',
        actorId: staff.id,
        idempotencyKey: 'full-spend-clawback-1',
      });

      const afterRefund = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterRefund.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterRefund.refundedAmount.toFixed(4)).toBe('0.0000');
      // Every AMD of this grant was already spent — the entire 500 is
      // permanently forfeited (never re-grantable) and released to revenue.
      expect(afterRefund.forfeitedAmount.toFixed(4)).toBe('500.0000');
      expect(afterRefund.grantedBonusLotId).toBeNull();

      const grantedLotAfter = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLotId } });
      expect(grantedLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');

      const ledgerTx = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'deferred_bonus.unlock_reversed', sourceId: lot.id },
        include: { postings: true },
      });
      const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
      const liabilityLeg = ledgerTx.postings.find((p) => p.accountId === bonusLiabilityAccount.id);
      expect(liabilityLeg?.amount.toFixed(4)).toBe('500.0000');

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.isNegative()).toBe(false);
      expect(walletAfter.availableBonus.toFixed(4)).toBe('0.0000');

      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('claws back the unlock on a partial refund alone, when that partial amount is what drops turnover below threshold', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      // 4900 + 1000 = 5900 >= 5000, comfortably unlocked.
      const { intent } = await confirmedPurchaseFor(user.id, '1000');
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;

      const staff = await staffMember(intent.partnerId);
      // Refund 700 of the 1000: 5900 - 700 = 5200... still above. Refund
      // 200 more (900 total): 5900 - 900 = 5000 -- still >= 5000 (>=, not
      // >). One more AMD tips it under.
      await refunds.refund({
        purchaseIntentId: intent.id,
        amount: '901',
        reason: 'partial return',
        actorId: staff.id,
        idempotencyKey: 'partial-drops-below-1',
      });

      const afterRefund = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterRefund.progressTurnover.toFixed(4)).toBe('4999.0000'); // 5900 - 901
      // Fully reclaimed (nothing spent), reverted to DEFERRED, own-purchase
      // and forfeiture tracking both untouched — ready to requalify.
      expect(afterRefund.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterRefund.refundedAmount.toFixed(4)).toBe('0.0000');
      expect(afterRefund.forfeitedAmount.toFixed(4)).toBe('0.0000');
      expect(afterRefund.grantedBonusLotId).toBeNull();

      const grantedLotAfter = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLotId } });
      expect(grantedLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');

      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('is idempotent — replaying the same refund key does not claw the unlocked grant twice', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      // 198 AMD purchase (unlocks: 4900+198=5098), refunded 99 at a time —
      // any amount works now that idempotent replays are resolved before
      // any state-dependent validation (see `purchase-intent-refund.int-
      // spec.ts`'s own idempotency-precheck-ordering tests); kept partial
      // here simply to also exercise the below-threshold drop.
      const { intent } = await confirmedPurchaseFor(user.id, '198');
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;

      const staff = await staffMember(intent.partnerId);
      const params = {
        purchaseIntentId: intent.id,
        amount: '99', // 5098 - 99 = 4999 < 5000
        reason: 'partial return',
        actorId: staff.id,
        idempotencyKey: 'idempotent-unlock-clawback-1',
      };
      const first = await refunds.refund(params);
      const second = await refunds.refund(params); // replay, same key

      expect(second).toEqual(first);
      // Nothing spent, so nothing forfeited, so no posting at all — but the
      // point of this test is that it happens exactly *once* either way,
      // never twice.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'deferred_bonus.unlock_reversed' } }),
      ).toBe(0);
      const grantedLotAfter = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLotId } });
      expect(grantedLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');

      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('claws back exactly once when two refunds against different contributing purchases race concurrently', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4800');
      // Two separate purchases both contribute turnover to the same lot;
      // together they unlock it (4800 + 100 + 100 = 5000).
      const { intent: intentA } = await confirmedPurchaseFor(user.id, '100');
      const { intent: intentB } = await confirmedPurchaseFor(user.id, '100');
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;
      expect(grantedLotId).toBeTruthy();

      const staffA = await staffMember(intentA.partnerId);
      const staffB = await staffMember(intentB.partnerId);

      // Refunding *either one alone* already drops turnover below 5000, so
      // both refunds race to claw the same grant back.
      await Promise.all([
        refunds.refund({
          purchaseIntentId: intentA.id,
          reason: 'concurrent return A',
          actorId: staffA.id,
          idempotencyKey: 'concurrent-unlock-a',
        }),
        refunds.refund({
          purchaseIntentId: intentB.id,
          reason: 'concurrent return B',
          actorId: staffB.id,
          idempotencyKey: 'concurrent-unlock-b',
        }),
      ]);

      const afterRefund = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterRefund.progressTurnover.toFixed(4)).toBe('4800.0000');
      // The 500 grant is clawed back exactly once, regardless of which
      // refund's transaction actually performed the claw — reverted to
      // DEFERRED, nothing spent so nothing forfeited, own-purchase tracking
      // untouched (neither A nor B is this lot's own originating purchase).
      expect(afterRefund.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterRefund.refundedAmount.toFixed(4)).toBe('0.0000');
      expect(afterRefund.forfeitedAmount.toFixed(4)).toBe('0.0000');
      expect(afterRefund.grantedBonusLotId).toBeNull();

      const grantedLotAfter = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLotId } });
      expect(grantedLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.isNegative()).toBe(false);

      // Nothing spent, nothing forfeited, no posting at all.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'deferred_bonus.unlock_reversed' } }),
      ).toBe(0);

      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('requalifies and unlocks exactly once more after later genuine turnover restores the threshold', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      // B unlocks it (4900+200=5100); B is refunded, dropping it back to
      // 4900 and reverting the lot to DEFERRED.
      const { intent: intentB } = await confirmedPurchaseFor(user.id, '200');
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;
      const staffB = await staffMember(intentB.partnerId);
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'requalify-refund-b',
      });
      const reverted = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(reverted.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(reverted.progressTurnover.toFixed(4)).toBe('4900.0000');

      // C brings genuine new turnover back over the threshold (4900+150=5050).
      await confirmedPurchaseFor(user.id, '150');

      const requalified = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(requalified.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      expect(requalified.progressTurnover.toFixed(4)).toBe('5050.0000');
      expect(requalified.grantedBonusLotId).toBeTruthy();
      expect(requalified.grantedBonusLotId).not.toBe(grantedLotId); // a fresh grant, not the clawed-back one

      // Nothing was ever spent from the first (invalidated) grant, so the
      // full original 500 — not a penny less — is granted again exactly
      // once: no double credit, no double liability.
      const newGrant = await prisma.bonusLot.findUniqueOrThrow({ where: { id: requalified.grantedBonusLotId! } });
      expect(newGrant.remainingAmount.toFixed(4)).toBe('500.0000');
      expect(newGrant.originalAmount.toFixed(4)).toBe('500.0000');

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.isNegative()).toBe(false);

      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('requalifies for only the still-valid remainder when the first grant was partially spent', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      const { intent: intentB } = await confirmedPurchaseFor(user.id, '200');
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;
      await isolateForSpend(wallet.id, grantedLotId);
      await spend(wallet.id, '300', 'requalify-partial-spend'); // 300 of 500 spent, 200 left

      const staffB = await staffMember(intentB.partnerId);
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'requalify-partial-refund-b',
      });
      const reverted = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(reverted.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(reverted.forfeitedAmount.toFixed(4)).toBe('300.0000'); // permanently gone

      await confirmedPurchaseFor(user.id, '150'); // 4900+150=5050, requalifies

      const requalified = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(requalified.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      // Only the still-valid 200 (500 - 300 already spent) grants again —
      // never the full 500, which would double-credit the 300 the customer
      // already irrevocably received.
      const newGrant = await prisma.bonusLot.findUniqueOrThrow({ where: { id: requalified.grantedBonusLotId! } });
      expect(newGrant.originalAmount.toFixed(4)).toBe('200.0000');

      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('never requalifies once the entire lot has been forfeited or refunded away', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      const { intent: intentB } = await confirmedPurchaseFor(user.id, '200');
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;
      await isolateForSpend(wallet.id, grantedLotId);
      await spend(wallet.id, '500', 'requalify-full-spend'); // the entire grant, nothing left to reclaim

      const staffB = await staffMember(intentB.partnerId);
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'requalify-none-refund-b',
      });
      const reverted = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(reverted.forfeitedAmount.toFixed(4)).toBe('500.0000'); // the entire lot, gone
      expect(reverted.progressTurnover.toFixed(4)).toBe('4900.0000'); // reverted by B's own refund

      await confirmedPurchaseFor(user.id, '150'); // would otherwise requalify: 4900+150=5050

      // Filtered out of `advanceExistingLots` entirely — nothing left to
      // ever grant, so it never unlocks again, and this purchase's turnover
      // isn't even applied to it (no more `DeferredBonusLotContribution`
      // rows are created for an already fully closed-out lot).
      const stillDeferred = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(stillDeferred.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(stillDeferred.grantedBonusLotId).toBeNull();
      expect(stillDeferred.progressTurnover.toFixed(4)).toBe('4900.0000');
    });

    it('combines correctly when the lot\'s own purchase is partially refunded on top of a full external-contributor clawback', async () => {
      const { user, wallet } = await createCustomer(prisma);
      // A creates the lot for real (so it can be partially refunded itself,
      // unlike a `seedLot` row with no backing PurchaseIntent): 20000 gross
      // @ 500bps -> pool 1000 -> deferred (30%) 300.
      const { intent: intentA } = await confirmedPurchaseFor(user.id, '20000');
      const lot = await prisma.deferredBonusLot.findFirstOrThrow({
        where: { sourceTransactionId: intentA.sourceTransactionId! },
      });
      expect(lot.amount.toFixed(4)).toBe('300.0000');

      // B supplies the full 54000 AMD required turnover, unlocking it.
      const { intent: intentB } = await confirmedPurchaseFor(user.id, '54000');
      const unlocked = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(unlocked.status).toBe(DeferredBonusLotStatus.AVAILABLE);

      const staffA = await staffMember(intentA.partnerId);
      const staffB = await staffMember(intentB.partnerId);

      // B fully refunded first: claws the unlock back (nothing spent),
      // reverts the lot to DEFERRED, forfeits nothing.
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'mixed-refund-b',
      });
      const afterB = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterB.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterB.forfeitedAmount.toFixed(4)).toBe('0.0000');

      // Then A is refunded *partially* — half its gross (10000 of 20000),
      // so half its deferred share (150 of 300) is permanently undone.
      await refunds.refund({
        purchaseIntentId: intentA.id,
        amount: '10000',
        reason: 'partial return A',
        actorId: staffA.id,
        idempotencyKey: 'mixed-refund-a-partial',
      });
      const afterA = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterA.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterA.refundedAmount.toFixed(4)).toBe('150.0000');
      expect(afterA.forfeitedAmount.toFixed(4)).toBe('0.0000');

      // C brings genuine new turnover to cross 54000 again — only the
      // still-valid 150 (300 - 150 already refunded away from A) is ever
      // grantable, never the original 300.
      await confirmedPurchaseFor(user.id, '54000');
      const requalified = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(requalified.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      const newGrant = await prisma.bonusLot.findUniqueOrThrow({ where: { id: requalified.grantedBonusLotId! } });
      expect(newGrant.originalAmount.toFixed(4)).toBe('150.0000');

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.isNegative()).toBe(false);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('requalifies exactly once when two contributing purchases race to cross the threshold again concurrently', async () => {
      const { user, wallet } = await createCustomer(prisma);
      const lot = await seedLot(user.id, '4900');
      const { intent: intentB } = await confirmedPurchaseFor(user.id, '200'); // unlocks: 4900+200=5100
      const staffB = await staffMember(intentB.partnerId);
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'race-requalify-refund-b',
      });
      const reverted = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(reverted.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(reverted.progressTurnover.toFixed(4)).toBe('4900.0000');

      // Two purchases, each alone insufficient, together cross 5000 again —
      // confirmed concurrently, racing on the same lot row. The atomic
      // `{ increment }` this codebase's original concurrency fix (GitHub
      // issue #28, `advanceExistingLots`) already uses protects this
      // *second* life of the lot exactly the same way it protects the
      // first — this test proves that still holds post-clawback.
      await Promise.all([
        confirmedPurchaseFor(user.id, '60'),
        confirmedPurchaseFor(user.id, '60'),
      ]);

      const requalified = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(requalified.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      expect(requalified.progressTurnover.toFixed(4)).toBe('5020.0000'); // 4900 + 60 + 60, neither contribution lost
      expect(requalified.grantedBonusLotId).toBeTruthy();

      // Granted exactly once, for the full still-valid 500 — not double.
      const newGrant = await prisma.bonusLot.findUniqueOrThrow({ where: { id: requalified.grantedBonusLotId! } });
      expect(newGrant.originalAmount.toFixed(4)).toBe('500.0000');
      // Only one *live* deferred grant exists — the first (B's, since
      // clawed back and fully reclaimed) is a separate, already-CONSUMED
      // historical row with nothing left in it, not a second concurrent
      // grant of the same 500 sitting in the wallet at once.
      const deferredLots = await prisma.bonusLot.findMany({
        where: { walletId: wallet.id, type: BonusEntryType.ACCRUAL_DEFERRED },
      });
      const live = deferredLots.filter((l) => l.status === BonusLotStatus.AVAILABLE);
      expect(live).toHaveLength(1);
      const totalCurrentlyOutstanding = deferredLots.reduce((sum, l) => sum.plus(l.remainingAmount), new Decimal(0));
      expect(totalCurrentlyOutstanding.toFixed(4)).toBe('500.0000');

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.isNegative()).toBe(false);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Item 2: Referral Challenge reward reversal ──────────────────────────

  describe('referral challenge reward reversal', () => {
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

    it('claws back only the unspent remainder when one side partially spent their reward, and writes off the rest', async () => {
      const { referrerUser, refereeUser, participant } = await invitedChallenge('10000');
      // Qualifies the Challenge (progress is transaction.amount, independent
      // of rate) but also credits the referee's own purchase accrual and the
      // referrer's recurring 20%-of-pool share into the same two wallets the
      // reward lands in — isolated out below so the spend below draws only
      // from each side's reward lot, not that contamination.
      const { intent } = await confirmedPurchaseFor(refereeUser.id, '10000');
      await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);

      const rewarded = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrerUser.id } });
      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: refereeUser.id } });
      await isolateForSpend(referrerWallet.id, rewarded.referrerBonusLotId!);
      await isolateForSpend(refereeWallet.id, rewarded.refereeBonusLotId!);

      // The referee spends 400 of their 1000; the referrer spends nothing.
      await spend(refereeWallet.id, '400', 'spend-reward-partial');

      const staff = await staffMember(intent.partnerId);
      await refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'full return',
        actorId: staff.id,
        idempotencyKey: 'challenge-partial-spend-1',
      });

      const after = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      expect(after.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);

      const referrerLotAfter = await prisma.bonusLot.findUniqueOrThrow({
        where: { id: rewarded.referrerBonusLotId! },
      });
      const refereeLotAfter = await prisma.bonusLot.findUniqueOrThrow({
        where: { id: rewarded.refereeBonusLotId! },
      });
      expect(referrerLotAfter.remainingAmount.toFixed(4)).toBe('0.0000'); // fully reclaimed
      expect(refereeLotAfter.remainingAmount.toFixed(4)).toBe('0.0000'); // 600 reclaimed, 400 written off

      const walletsAfter = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { id: referrerWallet.id } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: refereeWallet.id } }),
      ]);
      expect(walletsAfter.every((w) => !w.availableBonus.isNegative())).toBe(true);

      // Only 1000 (referrer, untouched) + 600 (referee, unspent) = 1600
      // reclaimed — never the full 2000, which would double-debit the 400
      // the referee already spent.
      const ledgerTx = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'referral.challenge_reward_reversed' },
        include: { postings: true },
      });
      const bonusLiabilityAccount = await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'BONUS_LIABILITY' } });
      const liabilityLeg = ledgerTx.postings.find((p) => p.accountId === bonusLiabilityAccount.id);
      expect(liabilityLeg?.amount.toFixed(4)).toBe('1600.0000');

      await assertWalletIntegrity(prisma, referrerWallet.id);
      await assertWalletIntegrity(prisma, refereeWallet.id);
    });

    it('writes off the full shortfall with no wallet clawback when both sides fully spent their reward', async () => {
      const { referrerUser, refereeUser, participant } = await invitedChallenge('10000');
      const { intent } = await confirmedPurchaseFor(refereeUser.id, '10000');
      await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);

      const rewarded = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrerUser.id } });
      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: refereeUser.id } });
      await isolateForSpend(referrerWallet.id, rewarded.referrerBonusLotId!);
      await isolateForSpend(refereeWallet.id, rewarded.refereeBonusLotId!);
      await spend(referrerWallet.id, '1000', 'spend-referrer-full');
      await spend(refereeWallet.id, '1000', 'spend-referee-full');

      const staff = await staffMember(intent.partnerId);
      await refunds.refund({
        purchaseIntentId: intent.id,
        reason: 'full return',
        actorId: staff.id,
        idempotencyKey: 'challenge-full-spend-1',
      });

      const after = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      expect(after.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);

      const referrerLotAfter = await prisma.bonusLot.findUniqueOrThrow({
        where: { id: rewarded.referrerBonusLotId! },
      });
      const refereeLotAfter = await prisma.bonusLot.findUniqueOrThrow({
        where: { id: rewarded.refereeBonusLotId! },
      });
      expect(referrerLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');
      expect(refereeLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');

      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'referral.challenge_reward_reversed' } }),
      ).toBe(0);

      // Nothing to reclaim for the reward itself — no posting for it. Both
      // wallets still land at exactly zero: this same purchase's own
      // (contaminating) green accrual and recurring referrer share are a
      // *separate* full refund of *this* purchase, reclaimed by the
      // ordinary refund path.
      const walletsAfter = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { id: referrerWallet.id } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: refereeWallet.id } }),
      ]);
      for (const w of walletsAfter) {
        expect(w.availableBonus.isNegative()).toBe(false);
        expect(w.availableBonus.toFixed(4)).toBe('0.0000');
      }

      await assertWalletIntegrity(prisma, referrerWallet.id);
      await assertWalletIntegrity(prisma, refereeWallet.id);
    });

    it('claws back the reward on a partial refund alone, when that partial amount is what drops progress below threshold', async () => {
      const { participant, refereeUser } = await invitedChallenge('10000');
      const { intent } = await confirmedPurchaseFor(refereeUser.id, '15000');
      await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);

      const staff = await staffMember(intent.partnerId);
      // 15000 - 5001 = 9999 < 10000.
      await refunds.refund({
        purchaseIntentId: intent.id,
        amount: '5001',
        reason: 'partial return',
        actorId: staff.id,
        idempotencyKey: 'challenge-partial-drops-below-1',
      });

      const after = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      expect(after.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
      expect(after.progressAmount.toFixed(4)).toBe('9999.0000');
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'referral.challenge_reward_reversed' } }),
      ).toBe(1);
    });

    it('is idempotent — replaying the same refund key does not claw the reward twice', async () => {
      const { participant, refereeUser } = await invitedChallenge('10000');
      const { intent } = await confirmedPurchaseFor(refereeUser.id, '15000');
      await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);

      const staff = await staffMember(intent.partnerId);
      // Partial, not full: a full refund's own replay hits
      // PurchaseIntentRefundService's separate "already refunded in full"
      // guard before idempotency is even consulted, an existing, unrelated
      // behavior this fix does not change.
      const params = {
        purchaseIntentId: intent.id,
        amount: '5001', // 15000 - 5001 = 9999 < 10000
        reason: 'partial return',
        actorId: staff.id,
        idempotencyKey: 'idempotent-reward-clawback-1',
      };
      const first = await refunds.refund(params);
      const second = await refunds.refund(params);

      expect(second).toEqual(first);
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'referral.challenge_reward_reversed' } }),
      ).toBe(1);
      const after = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      expect(after.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
    });

    it('frees the first-3 slot deterministically: a 4th referee can be rewarded once an earlier reward is reversed', async () => {
      const { user: referrerUser } = await createCustomer(prisma);

      // Three referees fill all three slots for real, through the actual
      // qualification flow.
      const rewardedParticipants = [];
      for (let i = 0; i < 3; i += 1) {
        const { user: refereeUser } = await createCustomer(prisma);
        await prisma.referralInvite.create({
          data: { referrerType: ReferrerType.USER, referrerUserId: referrerUser.id, refereeUserId: refereeUser.id },
        });
        const participant = await prisma.referralChallengeParticipant.create({
          data: { referrerUserId: referrerUser.id, refereeUserId: refereeUser.id, requiredAmount: '10000' },
        });
        const { intent } = await confirmedPurchaseFor(refereeUser.id, '10000');
        await referral.advanceChallengeProgress(refereeUser.id, intent.sourceTransactionId!);
        rewardedParticipants.push({ participant, refereeUser, intent });
      }
      for (const { participant } of rewardedParticipants) {
        expect(
          (await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: participant.id } }))
            .status,
        ).toBe(ReferralChallengeParticipantStatus.REWARDED);
      }

      // A 4th referee reaches the threshold too, but all 3 slots are taken
      // — qualifies without being rewarded.
      const { user: fourthReferee } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerType: ReferrerType.USER, referrerUserId: referrerUser.id, refereeUserId: fourthReferee.id },
      });
      const fourthParticipant = await prisma.referralChallengeParticipant.create({
        data: { referrerUserId: referrerUser.id, refereeUserId: fourthReferee.id, requiredAmount: '10000' },
      });
      const { intent: fourthIntent } = await confirmedPurchaseFor(fourthReferee.id, '10000');
      await referral.advanceChallengeProgress(fourthReferee.id, fourthIntent.sourceTransactionId!);
      expect(
        (await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: fourthParticipant.id } }))
          .status,
      ).toBe(ReferralChallengeParticipantStatus.QUALIFIED);

      // The first referee's purchase is refunded in full, un-rewarding
      // them and freeing their slot.
      const first = rewardedParticipants[0]!;
      const staff = await staffMember(first.intent.partnerId);
      await refunds.refund({
        purchaseIntentId: first.intent.id,
        reason: 'full return',
        actorId: staff.id,
        idempotencyKey: 'free-slot-1',
      });
      expect(
        (await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: first.participant.id } }))
          .status,
      ).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
      expect(
        await prisma.referralChallengeParticipant.count({
          where: { referrerUserId: referrerUser.id, status: ReferralChallengeParticipantStatus.REWARDED },
        }),
      ).toBe(2);

      // The 4th referee, still QUALIFIED and untouched, does not
      // automatically backfill the freed slot — this reward mechanic only
      // ever grants at the moment a participant's *own* qualifying
      // transaction crosses the threshold, never retroactively. A fresh
      // qualifying purchase for them now finds the slot open.
      expect(
        (await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: fourthParticipant.id } }))
          .status,
      ).toBe(ReferralChallengeParticipantStatus.QUALIFIED);

      const { intent: fifthIntent } = await confirmedPurchaseFor(fourthReferee.id, '1');
      await referral.advanceChallengeProgress(fourthReferee.id, fifthIntent.sourceTransactionId!);
      // Already QUALIFIED (not IN_PROGRESS), so advanceChallengeProgress's
      // own guard is a no-op for it — qualification order, not slot
      // availability, is what the reward mechanic re-checks live, and it
      // only re-checks on a *new* IN_PROGRESS -> QUALIFIED transition.
      // Confirming this documents the mechanic's actual, unchanged
      // behavior rather than asserting a retroactive-fill this fix does
      // not add.
      expect(
        (await prisma.referralChallengeParticipant.findUniqueOrThrow({ where: { id: fourthParticipant.id } }))
          .status,
      ).toBe(ReferralChallengeParticipantStatus.QUALIFIED);
    });

    it('claws back exactly once when two refunds against different contributing purchases race concurrently', async () => {
      const { referrerUser, refereeUser, participant } = await invitedChallenge('10000');
      // Two purchases jointly qualify: 6000 + 6000 = 12000 >= 10000.
      const { intent: intentA } = await confirmedPurchaseFor(refereeUser.id, '6000');
      await referral.advanceChallengeProgress(refereeUser.id, intentA.sourceTransactionId!);
      const { intent: intentB } = await confirmedPurchaseFor(refereeUser.id, '6000');
      await referral.advanceChallengeProgress(refereeUser.id, intentB.sourceTransactionId!);

      const rewarded = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      expect(rewarded.status).toBe(ReferralChallengeParticipantStatus.REWARDED);

      const staffA = await staffMember(intentA.partnerId);
      const staffB = await staffMember(intentB.partnerId);

      // Refunding *either purchase alone* drops progress to 6000, below
      // the 10000 threshold, so both race to claw back the same reward.
      await Promise.all([
        refunds.refund({
          purchaseIntentId: intentA.id,
          reason: 'concurrent return A',
          actorId: staffA.id,
          idempotencyKey: 'concurrent-reward-a',
        }),
        refunds.refund({
          purchaseIntentId: intentB.id,
          reason: 'concurrent return B',
          actorId: staffB.id,
          idempotencyKey: 'concurrent-reward-b',
        }),
      ]);

      const after = await prisma.referralChallengeParticipant.findUniqueOrThrow({
        where: { id: participant.id },
      });
      expect(after.status).toBe(ReferralChallengeParticipantStatus.IN_PROGRESS);
      expect(after.progressAmount.toFixed(4)).toBe('0.0000');

      const referrerLotAfter = await prisma.bonusLot.findUniqueOrThrow({
        where: { id: rewarded.referrerBonusLotId! },
      });
      const refereeLotAfter = await prisma.bonusLot.findUniqueOrThrow({
        where: { id: rewarded.refereeBonusLotId! },
      });
      expect(referrerLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');
      expect(refereeLotAfter.remainingAmount.toFixed(4)).toBe('0.0000');
      expect(referrerLotAfter.status).toBe(BonusLotStatus.CONSUMED);
      expect(refereeLotAfter.status).toBe(BonusLotStatus.CONSUMED);

      // Clawed exactly once, not once per racing refund.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'referral.challenge_reward_reversed' } }),
      ).toBe(1);

      const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrerUser.id } });
      const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: refereeUser.id } });
      expect(referrerWallet.availableBonus.isNegative()).toBe(false);
      expect(refereeWallet.availableBonus.isNegative()).toBe(false);

      await assertWalletIntegrity(prisma, referrerWallet.id);
      await assertWalletIntegrity(prisma, refereeWallet.id);
    });
  });

  // ── Deferred lot: two independent reversal mechanisms, same lot ────────

  describe('deferred bonus lot — the lot\'s own purchase and an external contributor both refunded', () => {
    /**
     * `reverseForRefund` (the lot's *own* originating purchase refunded) and
     * `reverseUnlock` (a *different*, external contributing purchase's
     * refund dropping the lot's turnover back below threshold) must never
     * double-process the same AMD, in either order — independent audit,
     * GitHub issue #28. `refundedAmount` (own-purchase history) and
     * `forfeitedAmount` (permanently written off by a past `reverseUnlock`
     * clawback that could not fully reclaim an invalidated grant) together
     * form the lot's ceiling for both mechanisms; `reverseForRefund` also
     * clears `grantedBonusLotId` whenever *it* fully drains the live grant,
     * so a `reverseUnlock` that runs afterward finds nothing left and no-ops
     * immediately rather than misreading already-reclaimed value as newly
     * discovered spend. Nothing here is ever spent by the customer, so the
     * whole round trip below always nets every account back to exactly
     * zero, in either order.
     *
     * Both purchases here are real (not seeded directly via Prisma), so the
     * whole ledger is self-consistent from the start and this "nets to
     * zero" check is meaningful.
     */
    const twoPurchaseLot = async () => {
      const { user, wallet } = await createCustomer(prisma);
      // A: 20000 gross @ 500bps -> pool 1000 -> deferred (30%) 300. Creates
      // the lot; a purchase's own grossAmount is never applied as turnover
      // to the lot it just created (spec §15's "existing lots first, then
      // this purchase's own new lot" ordering), so the lot starts at 0.
      const { intent: intentA } = await confirmedPurchaseFor(user.id, '20000');
      const lot = await prisma.deferredBonusLot.findFirstOrThrow({
        where: { sourceTransactionId: intentA.sourceTransactionId! },
      });
      expect(lot.amount.toFixed(4)).toBe('300.0000');
      expect(lot.status).toBe(DeferredBonusLotStatus.DEFERRED);

      // B: exactly the 54000 AMD required turnover, contributed entirely to
      // A's lot via `advanceExistingLots` — crosses the threshold, unlocking
      // it and granting the full 300 AMD.
      const { intent: intentB } = await confirmedPurchaseFor(user.id, '54000');
      const unlocked = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(unlocked.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      expect(unlocked.progressTurnover.toFixed(4)).toBe('54000.0000');
      expect(unlocked.grantedBonusLotId).toBeTruthy();

      return { user, wallet, lot, intentA, intentB };
    };

    it('nets every account back to zero when the external contributor is refunded first', async () => {
      const { wallet, lot, intentA, intentB } = await twoPurchaseLot();
      const staffA = await staffMember(intentA.partnerId);
      const staffB = await staffMember(intentB.partnerId);

      // B first: an external contributor's refund drops turnover back below
      // 54000, clawing the unlock back via `reverseUnlock` — fully reclaimed
      // (nothing was ever spent), reverted to DEFERRED, nothing forfeited.
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'order-b-first-b',
      });
      const afterB = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterB.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterB.refundedAmount.toFixed(4)).toBe('0.0000');
      expect(afterB.forfeitedAmount.toFixed(4)).toBe('0.0000');
      expect(afterB.grantedBonusLotId).toBeNull();

      // Then A: the lot's own originating purchase is refunded too. The
      // 300 reclaimed by B's refund reverted to ordinary outstanding
      // `BONUS_LIABILITY` — A's own refund is what finally, genuinely
      // releases it now that A itself is undone (the `DEFERRED` branch of
      // `reverseForRefund`).
      await refunds.refund({
        purchaseIntentId: intentA.id,
        reason: 'return A',
        actorId: staffA.id,
        idempotencyKey: 'order-b-first-a',
      });

      const accounts = await prisma.ledgerAccount.findMany();
      for (const account of accounts) {
        expect(account.balance.toFixed(4)).toBe('0.0000');
      }
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('nets every account back to zero when the lot\'s own purchase is refunded first', async () => {
      const { wallet, lot, intentA, intentB } = await twoPurchaseLot();
      const staffA = await staffMember(intentA.partnerId);
      const staffB = await staffMember(intentB.partnerId);

      // A first: the lot's own originating purchase is refunded — claws
      // back via `reverseForRefund`'s own AVAILABLE-lot branch, fully, and
      // — since that fully drains the live grant — clears
      // `grantedBonusLotId` too. `status` itself stays `AVAILABLE`:
      // `reverseForRefund` never reverts it (only `reverseUnlock` does,
      // deliberately, to let the lot requalify — a fully-refunded own
      // purchase should *not* requalify).
      await refunds.refund({
        purchaseIntentId: intentA.id,
        reason: 'return A',
        actorId: staffA.id,
        idempotencyKey: 'order-a-first-a',
      });
      const afterA = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterA.refundedAmount.toFixed(4)).toBe('300.0000');
      expect(afterA.grantedBonusLotId).toBeNull();
      expect(afterA.status).toBe(DeferredBonusLotStatus.AVAILABLE);

      // Then B: the external contributor is refunded too, dropping turnover
      // below threshold — `reverseUnlock` finds `grantedBonusLotId` already
      // null (cleared by A's own reclaim above) and no-ops immediately,
      // correctly, since A's own refund already fully accounted for this
      // lot's entire value.
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'order-a-first-b',
      });

      const accounts = await prisma.ledgerAccount.findMany();
      for (const account of accounts) {
        expect(account.balance.toFixed(4)).toBe('0.0000');
      }
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('does not double-count a partial own-purchase reclaim as newly-forfeited spend when an external refund later invalidates the same still-live grant', async () => {
      // Second-pass independent audit against this file's own fix (GitHub
      // issue #28): A's partial refund reclaims part of the live grant via
      // `reverseForRefund`'s AVAILABLE branch *without* fully draining it
      // (unlike the sibling test above, where B is refunded first and A's
      // later partial refund goes through the DEFERRED branch instead,
      // never touching the wallet). Only *then* is B refunded, invalidating
      // the same still-partly-live grant via `reverseUnlock`. Nothing was
      // ever spent by the customer here — every AMD removed from the grant
      // was already accounted for by A's own refund — so `forfeitedAmount`
      // must stay zero and the still-valid remainder must survive.
      const { user, wallet, lot, intentA, intentB } = await twoPurchaseLot();
      const staffA = await staffMember(intentA.partnerId);
      const staffB = await staffMember(intentB.partnerId);
      const grantedLotId = (await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } }))
        .grantedBonusLotId!;

      // A refunded *partially* first, while the grant is still live: half
      // its gross (10000 of 20000) reclaims half its deferred share (150 of
      // 300) straight out of the wallet — the grant is left with 150
      // remaining, not fully drained, so `grantedBonusLotId` stays set.
      await refunds.refund({
        purchaseIntentId: intentA.id,
        amount: '10000',
        reason: 'partial return A',
        actorId: staffA.id,
        idempotencyKey: 'no-double-count-a-partial',
      });
      const afterA = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterA.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      expect(afterA.refundedAmount.toFixed(4)).toBe('150.0000');
      expect(afterA.forfeitedAmount.toFixed(4)).toBe('0.0000');
      expect(afterA.grantedBonusLotId).toBe(grantedLotId);
      const grantedAfterA = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLotId } });
      expect(grantedAfterA.remainingAmount.toFixed(4)).toBe('150.0000');

      // Then B: the external contributor is refunded, dropping turnover
      // below threshold and invalidating the same still-live grant via
      // `reverseUnlock`. The 150 it claws back was *already* reclaimed and
      // accounted for by A's refund above — none of it is newly-discovered
      // customer spend, so nothing new should ever be forfeited.
      await refunds.refund({
        purchaseIntentId: intentB.id,
        reason: 'return B',
        actorId: staffB.id,
        idempotencyKey: 'no-double-count-b',
      });

      const afterB = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(afterB.status).toBe(DeferredBonusLotStatus.DEFERRED);
      expect(afterB.refundedAmount.toFixed(4)).toBe('150.0000');
      // The bug: `spent` was computed as `originalAmount - actual`
      // (300 - 150 = 150) with no way to know 150 of that gap was already
      // A's own refund, not new spend — forfeiting it a second time and
      // permanently destroying the 150 that was never refunded at all.
      expect(afterB.forfeitedAmount.toFixed(4)).toBe('0.0000');
      expect(afterB.grantedBonusLotId).toBeNull();

      const grantedAfterB = await prisma.bonusLot.findUniqueOrThrow({ where: { id: grantedLotId } });
      expect(grantedAfterB.remainingAmount.toFixed(4)).toBe('0.0000');

      // No phantom revenue recognition: nothing was actually spent, so no
      // ledger posting should exist for this reversal at all.
      expect(
        await prisma.ledgerTransaction.count({ where: { kind: 'deferred_bonus.unlock_reversed', sourceId: lot.id } }),
      ).toBe(0);

      // The still-valid 150 (300 - 150 refunded, 0 forfeited) must survive
      // and be grantable again exactly once, for exactly that amount, once
      // genuine turnover restores the threshold.
      await confirmedPurchaseFor(user.id, '54000');
      const requalified = await prisma.deferredBonusLot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(requalified.status).toBe(DeferredBonusLotStatus.AVAILABLE);
      const newGrant = await prisma.bonusLot.findUniqueOrThrow({ where: { id: requalified.grantedBonusLotId! } });
      expect(newGrant.originalAmount.toFixed(4)).toBe('150.0000');

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      expect(walletAfter.availableBonus.isNegative()).toBe(false);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });
});
