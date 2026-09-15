import { BadRequestException } from '@nestjs/common';
import {
  BonusEntryType,
  BonusLotStatus,
  BonusReservationStatus,
  LedgerDirection,
  PrismaClient,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BonusEngineService } from '../src/modules/wallet/bonus-engine.service';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';
import { assertWalletIntegrity } from './setup/invariants';

/**
 * The bonus engine against a real PostgreSQL database.
 *
 * Every test ends with `assertWalletIntegrity`, which replays the ledger and
 * compares it to the wallet, checks the lots back the balances, and verifies
 * no bucket went negative. That is what makes this suite a regression net
 * rather than a set of remembered numbers: an arithmetic change that is wrong
 * fails integrity even in a scenario nobody anticipated.
 */
describe('BonusEngineService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let engine: BonusEngineService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    engine = harness.app.get(BonusEngineService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const walletOf = async (walletId: string) =>
    prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

  const ledgerOf = (walletId: string) =>
    prisma.bonusLedgerEntry.findMany({ where: { walletId }, orderBy: { createdAt: 'asc' } });

  // ── Accrual ─────────────────────────────────────────────────────────────

  describe('accrue', () => {
    it('lands in pending during the cooling-off window, not in available', async () => {
      const { wallet } = await createCustomer(prisma);

      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
      });

      const after = await walletOf(wallet.id);
      expect(after.pendingBonus.toFixed(4)).toBe('1000.0000');
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      // Earned the moment it is accrued, even while still cooling off.
      expect(after.lifetimeEarned.toFixed(4)).toBe('1000.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('is immediately available when the window is zero', async () => {
      const { wallet } = await createCustomer(prisma);

      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PROMOTION,
        amount: '250.5',
        pendingHours: 0,
      });

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('250.5000');
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('writes exactly one CREDIT entry whose deltas describe the movement', async () => {
      const { wallet } = await createCustomer(prisma);

      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_REFERRAL,
        amount: '500',
        pendingHours: 0,
      });

      const entries = await ledgerOf(wallet.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.direction).toBe(LedgerDirection.CREDIT);
      expect(entries[0]!.availableDelta.toFixed(4)).toBe('500.0000');
      expect(entries[0]!.pendingDelta.toFixed(4)).toBe('0.0000');
      // balanceAfter means total outstanding — one meaning, everywhere.
      expect(entries[0]!.balanceAfter.toFixed(4)).toBe('500.0000');
    });

    it.each(['0', '-1', 'NaN', 'Infinity', '1.00005'])(
      'refuses to accrue %p',
      async (amount) => {
        const { wallet } = await createCustomer(prisma);

        await expect(
          engine.accrue({
            walletId: wallet.id,
            type: BonusEntryType.ACCRUAL_PURCHASE,
            amount,
          }),
        ).rejects.toThrow(BadRequestException);

        // The rejection must leave nothing behind — not a lot, not an entry.
        expect(await prisma.bonusLot.count({ where: { walletId: wallet.id } })).toBe(0);
        await assertWalletIntegrity(prisma, wallet.id);
      },
    );

    it('refuses an accrual that would expire before it becomes available', async () => {
      const { wallet } = await createCustomer(prisma);

      await expect(
        engine.accrue({
          walletId: wallet.id,
          type: BonusEntryType.ACCRUAL_PURCHASE,
          amount: '100',
          // Configured expiry is 12 months; a 2-year window outlives it.
          pendingHours: 24 * 365 * 2,
        }),
      ).rejects.toThrow(/expire before it becomes available/);
    });
  });

  // ── Reserve / settle / release ──────────────────────────────────────────

  describe('reserve', () => {
    const seedAvailable = async (amount: string) => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount,
        pendingHours: 0,
      });
      return wallet;
    };

    it('moves points from available to reserved without changing the total', async () => {
      const wallet = await seedAvailable('1000');

      await engine.reserve(wallet.id, '400', 'tx-1');

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('600.0000');
      expect(after.reservedBonus.toFixed(4)).toBe('400.0000');
      // A hold is not a spend: lifetimeSpent must not move yet.
      expect(after.lifetimeSpent.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('records the hold as NEUTRAL, not as a redemption debit', async () => {
      const wallet = await seedAvailable('1000');
      await engine.reserve(wallet.id, '400', 'tx-1');

      const hold = (await ledgerOf(wallet.id)).at(-1)!;
      expect(hold.type).toBe(BonusEntryType.RESERVE_HOLD);
      expect(hold.direction).toBe(LedgerDirection.NEUTRAL);
      expect(hold.availableDelta.toFixed(4)).toBe('-400.0000');
      expect(hold.reservedDelta.toFixed(4)).toBe('400.0000');
      // Before this split, reserve *and* settle each wrote a REDEMPTION
      // DEBIT, so summing debits double-counted every single spend.
      const redemptions = (await ledgerOf(wallet.id)).filter((e) =>
        e.type.startsWith('REDEMPTION_'),
      );
      expect(redemptions).toHaveLength(0);
    });

    it('rejects a hold larger than the available balance', async () => {
      const wallet = await seedAvailable('100');

      await expect(engine.reserve(wallet.id, '100.0001', 'tx-1')).rejects.toThrow(
        /Insufficient available bonus/,
      );

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('100.0000');
      expect(after.reservedBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it.each(['0', '-100', 'NaN'])('rejects a hold of %p', async (amount) => {
      const wallet = await seedAvailable('1000');
      await expect(engine.reserve(wallet.id, amount, 'tx-1')).rejects.toThrow(BadRequestException);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('consumes the soonest-expiring lot first', async () => {
      const { wallet } = await createCustomer(prisma);
      const early = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '300',
        pendingHours: 0,
      });
      const late = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '300',
        pendingHours: 0,
      });
      // Push the second lot's expiry further out so the ordering is explicit.
      await prisma.bonusLot.update({
        where: { id: late.id },
        data: { expiresAt: new Date(Date.now() + 400 * 24 * 3_600_000) },
      });

      await engine.reserve(wallet.id, '300', 'tx-1');

      // FIFO by expiry is what makes "expiring soon" honest: taking from the
      // late lot first would quietly expire points the customer could have
      // spent.
      expect((await prisma.bonusLot.findUniqueOrThrow({ where: { id: early.id } })).remainingAmount
        .toFixed(4)).toBe('0.0000');
      expect((await prisma.bonusLot.findUniqueOrThrow({ where: { id: late.id } })).remainingAmount
        .toFixed(4)).toBe('300.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('spans multiple lots when no single lot is large enough', async () => {
      const { wallet } = await createCustomer(prisma);
      for (const amount of ['100', '100', '100']) {
        await engine.accrue({
          walletId: wallet.id,
          type: BonusEntryType.ACCRUAL_PURCHASE,
          amount,
          pendingHours: 0,
        });
      }

      const reservation = await engine.reserve(wallet.id, '250', 'tx-1');

      const allocations = await prisma.bonusReservationAllocation.findMany({
        where: { reservationId: reservation.reservationId },
      });
      expect(allocations).toHaveLength(3);
      expect(
        allocations
          .reduce((acc, a) => acc.plus(a.amount), new Decimal(0))
          .toFixed(4),
      ).toBe('250.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('cannot hold the same points twice concurrently', async () => {
      const wallet = await seedAvailable('100');

      // Both holds want the whole balance. Exactly one may win — the other
      // must lose on the Serializable conflict or the balance check, never
      // silently succeed and drive the wallet negative.
      const results = await Promise.allSettled([
        engine.reserve(wallet.id, '100', 'tx-a'),
        engine.reserve(wallet.id, '100', 'tx-b'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      expect(after.reservedBonus.toFixed(4)).toBe('100.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('settleReservation', () => {
    const held = async (available: string, hold: string) => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: available,
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, hold, 'tx-1');
      return { wallet, reservation };
    };

    it('is the only place the spend is recorded', async () => {
      const { wallet, reservation } = await held('1000', '400');

      await engine.settleReservation(reservation.reservationId);

      const after = await walletOf(wallet.id);
      expect(after.reservedBonus.toFixed(4)).toBe('0.0000');
      expect(after.availableBonus.toFixed(4)).toBe('600.0000');
      expect(after.lifetimeSpent.toFixed(4)).toBe('400.0000');

      const debits = (await ledgerOf(wallet.id)).filter(
        (e) => e.direction === LedgerDirection.DEBIT,
      );
      expect(debits).toHaveLength(1);
      expect(debits[0]!.amount.toFixed(4)).toBe('400.0000');
      expect(debits[0]!.reservedDelta.toFixed(4)).toBe('-400.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('marks a fully-drained lot CONSUMED', async () => {
      const { wallet, reservation } = await held('400', '400');
      await engine.settleReservation(reservation.reservationId);

      const lots = await prisma.bonusLot.findMany({ where: { walletId: wallet.id } });
      expect(lots.every((l) => l.status === BonusLotStatus.CONSUMED)).toBe(true);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('refuses to settle the same hold twice', async () => {
      const { wallet, reservation } = await held('1000', '400');
      await engine.settleReservation(reservation.reservationId);

      // Without this guard a retried request charges the customer twice.
      await expect(engine.settleReservation(reservation.reservationId)).rejects.toThrow(
        /not active/,
      );

      expect((await walletOf(wallet.id)).lifetimeSpent.toFixed(4)).toBe('400.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('releaseReservation', () => {
    it('returns the hold to available and leaves the total unchanged', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-1');

      await engine.releaseReservation(reservation.reservationId, 'test');

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('1000.0000');
      expect(after.reservedBonus.toFixed(4)).toBe('0.0000');
      expect(after.lifetimeSpent.toFixed(4)).toBe('0.0000');

      const last = (await ledgerOf(wallet.id)).at(-1)!;
      expect(last.type).toBe(BonusEntryType.RESERVE_RELEASE);
      expect(last.direction).toBe(LedgerDirection.NEUTRAL);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('refuses to release a settled hold — that would mint the spend back', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-1');
      await engine.settleReservation(reservation.reservationId);

      await expect(engine.releaseReservation(reservation.reservationId, 'test')).rejects.toThrow(
        /not active/,
      );
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Compensation ────────────────────────────────────────────────────────

  describe('compensateReservation', () => {
    const settledHold = async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-1');
      await engine.settleReservation(reservation.reservationId);
      return { wallet, reservation };
    };

    it('releases a hold that has not settled yet', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-1');

      expect(await engine.compensateReservation(reservation.reservationId, 'saga_failed')).toBe(
        'released',
      );
      expect((await walletOf(wallet.id)).availableBonus.toFixed(4)).toBe('1000.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('reverses a hold that already settled, giving the points back', async () => {
      const { wallet, reservation } = await settledHold();

      expect(await engine.compensateReservation(reservation.reservationId, 'saga_failed')).toBe(
        'reversed',
      );

      const after = await walletOf(wallet.id);
      // The customer is whole again: the spend is undone in both the balance
      // and the lifetime counter.
      expect(after.availableBonus.toFixed(4)).toBe('1000.0000');
      expect(after.lifetimeSpent.toFixed(4)).toBe('0.0000');

      const last = (await ledgerOf(wallet.id)).at(-1)!;
      expect(last.type).toBe(BonusEntryType.REVERSAL);
      expect(last.direction).toBe(LedgerDirection.CREDIT);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('is idempotent — a retried rollback cannot mint points', async () => {
      const { wallet, reservation } = await settledHold();

      await engine.compensateReservation(reservation.reservationId, 'saga_failed');
      await engine.compensateReservation(reservation.reservationId, 'saga_failed');
      await engine.compensateReservation(reservation.reservationId, 'saga_failed');

      expect((await walletOf(wallet.id)).availableBonus.toFixed(4)).toBe('1000.0000');
      const reversals = (await ledgerOf(wallet.id)).filter(
        (e) => e.type === BonusEntryType.REVERSAL,
      );
      expect(reversals).toHaveLength(1);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('does nothing to an already-released hold', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      const reservation = await engine.reserve(wallet.id, '400', 'tx-1');
      await engine.releaseReservation(reservation.reservationId, 'first');

      expect(await engine.compensateReservation(reservation.reservationId, 'second')).toBe('noop');
      expect((await walletOf(wallet.id)).availableBonus.toFixed(4)).toBe('1000.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('reverseAccrualLot', () => {
    it('claws back an accrual whose transaction failed', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '50',
        pendingHours: 0,
      });

      await engine.reverseAccrualLot(lot.id, 'saga_failed');

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      expect(after.lifetimeEarned.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('claws back from pending when the lot never cleared', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '50',
      });

      await engine.reverseAccrualLot(lot.id, 'saga_failed');

      expect((await walletOf(wallet.id)).pendingBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('takes back only what is left, never driving the wallet negative', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '100',
        pendingHours: 0,
      });
      // The customer already spent 60 of the 100.
      const reservation = await engine.reserve(wallet.id, '60', 'tx-spend');
      await engine.settleReservation(reservation.reservationId);

      await engine.reverseAccrualLot(lot.id, 'saga_failed');

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      expect(after.availableBonus.isNegative()).toBe(false);
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  // ── Scheduled maintenance ───────────────────────────────────────────────

  describe('promotePendingLots', () => {
    it('moves a cleared lot into available without changing the total', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '750',
      });
      await prisma.bonusLot.update({
        where: { id: lot.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });

      expect(await engine.promotePendingLots()).toBe(1);

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('750.0000');
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');

      const last = (await ledgerOf(wallet.id)).at(-1)!;
      expect(last.type).toBe(BonusEntryType.PENDING_PROMOTION);
      expect(last.direction).toBe(LedgerDirection.NEUTRAL);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('leaves a lot still inside its window alone', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '750',
      });

      expect(await engine.promotePendingLots()).toBe(0);
      expect((await walletOf(wallet.id)).pendingBonus.toFixed(4)).toBe('750.0000');
    });

    it('promotes each lot exactly once even if the sweep runs repeatedly', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '750',
      });
      await prisma.bonusLot.update({
        where: { id: lot.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });

      await engine.promotePendingLots();
      await engine.promotePendingLots();

      expect((await walletOf(wallet.id)).availableBonus.toFixed(4)).toBe('750.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('expireLots', () => {
    it('debits expired points out of the wallet', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '500',
        pendingHours: 0,
      });
      await prisma.bonusLot.update({
        where: { id: lot.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect(await engine.expireLots()).toBe(1);

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      const last = (await ledgerOf(wallet.id)).at(-1)!;
      expect(last.type).toBe(BonusEntryType.EXPIRY);
      expect(last.direction).toBe(LedgerDirection.DEBIT);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('does not expire points that are currently held', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '500',
        pendingHours: 0,
      });
      await engine.reserve(wallet.id, '500', 'tx-1');
      await prisma.bonusLot.update({
        where: { id: lot.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // The lot's remainder is zero because the hold took it. Expiring it
      // anyway would debit points that are about to be spent — charging the
      // customer twice for one payment.
      expect(await engine.expireLots()).toBe(0);
      expect((await walletOf(wallet.id)).reservedBonus.toFixed(4)).toBe('500.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('expires a pending lot out of the pending bucket', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '500',
      });
      await prisma.bonusLot.update({
        where: { id: lot.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await engine.expireLots();

      const after = await walletOf(wallet.id);
      expect(after.pendingBonus.toFixed(4)).toBe('0.0000');
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });
  });

  describe('releaseExpiredReservations', () => {
    it('rescues points stranded by a process that died mid-payment', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      // A hold placed, then nothing — the classic crash between reserve and
      // settle. Before the sweep existed these points were unrecoverable
      // without a manual database edit.
      const reservation = await engine.reserve(wallet.id, '400', 'tx-1', 1);
      await prisma.bonusReservation.update({
        where: { id: reservation.reservationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect(await engine.releaseExpiredReservations()).toBe(1);

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('1000.0000');
      expect(after.reservedBonus.toFixed(4)).toBe('0.0000');
      expect(
        (await prisma.bonusReservation.findUniqueOrThrow({ where: { id: reservation.reservationId } }))
          .status,
      ).toBe(BonusReservationStatus.RELEASED);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('leaves a hold that is still within its window', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '1000',
        pendingHours: 0,
      });
      await engine.reserve(wallet.id, '400', 'tx-1');

      expect(await engine.releaseExpiredReservations()).toBe(0);
      expect((await walletOf(wallet.id)).reservedBonus.toFixed(4)).toBe('400.0000');
    });
  });

  // ── Administrative ──────────────────────────────────────────────────────

  describe('manualAdjustment', () => {
    it('credits immediately available points', async () => {
      const { wallet } = await createCustomer(prisma);

      await engine.manualAdjustment(wallet.id, '123.4567', LedgerDirection.CREDIT, 'goodwill');

      expect((await walletOf(wallet.id)).availableBonus.toFixed(4)).toBe('123.4567');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('debits against real lots', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '500',
        pendingHours: 0,
      });

      await engine.manualAdjustment(wallet.id, '200', LedgerDirection.DEBIT, 'chargeback');

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('300.0000');
      expect(after.lifetimeSpent.toFixed(4)).toBe('200.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('refuses a debit larger than the balance instead of going negative', async () => {
      const { wallet } = await createCustomer(prisma);
      await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '100',
        pendingHours: 0,
      });

      await expect(
        engine.manualAdjustment(wallet.id, '500', LedgerDirection.DEBIT, 'oops'),
      ).rejects.toThrow(/Insufficient available balance/);
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rejects a negative adjustment in either direction', async () => {
      const { wallet } = await createCustomer(prisma);

      // A negative DEBIT was a credit in disguise: the admin endpoint could
      // mint unlimited points through a "debit" of -1000000.
      await expect(
        engine.manualAdjustment(wallet.id, '-1000000', LedgerDirection.DEBIT, 'exploit'),
      ).rejects.toThrow(/must not be negative/);
      await expect(
        engine.manualAdjustment(wallet.id, '-1000000', LedgerDirection.CREDIT, 'exploit'),
      ).rejects.toThrow(/must not be negative/);

      const after = await walletOf(wallet.id);
      expect(after.availableBonus.toFixed(4)).toBe('0.0000');
      await assertWalletIntegrity(prisma, wallet.id);
    });

    it('rejects NEUTRAL, which has no defined effect on a balance', async () => {
      const { wallet } = await createCustomer(prisma);
      await expect(
        engine.manualAdjustment(wallet.id, '100', LedgerDirection.NEUTRAL, 'nonsense'),
      ).rejects.toThrow(/must be CREDIT or DEBIT/);
    });
  });

  // ── Database-level defence ──────────────────────────────────────────────

  describe('database constraints', () => {
    it('refuses to store a negative wallet balance even by raw SQL', async () => {
      const { wallet } = await createCustomer(prisma);

      // The last line of defence: if every application guard were somehow
      // bypassed, the state still cannot be written.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "wallets" SET "availableBonus" = -1 WHERE id = '${wallet.id}'`,
        ),
      ).rejects.toThrow(/wallets_balances_non_negative/);
    });

    it('refuses a ledger entry whose deltas contradict its direction', async () => {
      const { wallet } = await createCustomer(prisma);

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "bonus_ledger_entries"
             (id, "walletId", type, direction, amount,
              "availableDelta", "pendingDelta", "reservedDelta", "balanceAfter")
           VALUES (gen_random_uuid(), '${wallet.id}', 'ACCRUAL_PURCHASE', 'CREDIT', 100,
                   -100, 0, 0, 0)`,
        ),
      ).rejects.toThrow(/bonus_ledger_delta_matches_direction/);
    });

    it('refuses a lot whose remainder exceeds what was accrued', async () => {
      const { wallet } = await createCustomer(prisma);
      const lot = await engine.accrue({
        walletId: wallet.id,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        amount: '100',
        pendingHours: 0,
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "bonus_lots" SET "remainingAmount" = 200 WHERE id = '${lot.id}'`,
        ),
      ).rejects.toThrow(/bonus_lots_amounts_sane/);
    });
  });
});
