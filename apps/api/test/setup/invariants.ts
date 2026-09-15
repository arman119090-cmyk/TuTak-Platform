import { BonusLotStatus, BonusReservationStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * The regression net.
 *
 * These are the properties that must hold after *every* money operation, no
 * matter which one. Each integration test calls `assertWalletIntegrity` after
 * acting, so a future change that gets the arithmetic right in one path and
 * wrong in another cannot pass: the ledger stops reconstructing the wallet,
 * or the lots stop backing the balances, and the suite fails with the
 * specific invariant named.
 *
 * That is the mechanism behind requirement 7 — "any change to money logic
 * must break the tests if correctness is violated". It is deliberately
 * property-based rather than a list of expected numbers, because a list of
 * expected numbers only catches the cases someone thought to write down.
 */

const ZERO = new Decimal(0);

export async function assertLedgerReconstructsWallet(prisma: PrismaClient, walletId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const entries = await prisma.bonusLedgerEntry.findMany({
    where: { walletId },
    orderBy: { createdAt: 'asc' },
  });

  const replayed = entries.reduce(
    (acc, e) => ({
      available: acc.available.plus(e.availableDelta),
      pending: acc.pending.plus(e.pendingDelta),
      reserved: acc.reserved.plus(e.reservedDelta),
    }),
    { available: ZERO, pending: ZERO, reserved: ZERO },
  );

  expect(replayed.available.toFixed(4)).toBe(wallet.availableBonus.toFixed(4));
  expect(replayed.pending.toFixed(4)).toBe(wallet.pendingBonus.toFixed(4));
  expect(replayed.reserved.toFixed(4)).toBe(wallet.reservedBonus.toFixed(4));
}

/**
 * Each entry's own deltas must agree with its declared direction. The
 * database enforces this too (CHECK bonus_ledger_delta_matches_direction),
 * but asserting it here names the offending entry instead of surfacing an
 * opaque constraint violation from three layers down.
 */
export async function assertLedgerEntriesWellFormed(prisma: PrismaClient, walletId: string) {
  const entries = await prisma.bonusLedgerEntry.findMany({ where: { walletId } });

  for (const entry of entries) {
    const net = entry.availableDelta.plus(entry.pendingDelta).plus(entry.reservedDelta);
    const expected =
      entry.direction === 'CREDIT'
        ? entry.amount
        : entry.direction === 'DEBIT'
          ? entry.amount.negated()
          : ZERO;

    expect({
      id: entry.id,
      type: entry.type,
      net: net.toFixed(4),
    }).toEqual({ id: entry.id, type: entry.type, net: expected.toFixed(4) });

    // Magnitude is always non-negative; sign lives in the deltas alone.
    expect(entry.amount.isNegative()).toBe(false);
  }
}

/**
 * The lots and reservations must back the cached balances:
 *   available = Σ remaining of AVAILABLE lots
 *   pending   = Σ remaining of PENDING lots
 *   reserved  = Σ amount of ACTIVE reservations
 *
 * This is what catches a change that updates the wallet counters but forgets
 * the lots (or vice versa) — the exact failure mode that lets a customer
 * spend points twice.
 */
export async function assertLotsBackBalances(prisma: PrismaClient, walletId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const lots = await prisma.bonusLot.findMany({ where: { walletId } });
  const reservations = await prisma.bonusReservation.findMany({
    where: { walletId, status: BonusReservationStatus.ACTIVE },
  });

  const sum = (status: BonusLotStatus) =>
    lots
      .filter((l) => l.status === status)
      .reduce((acc, l) => acc.plus(l.remainingAmount), ZERO);

  expect(sum(BonusLotStatus.AVAILABLE).toFixed(4)).toBe(wallet.availableBonus.toFixed(4));
  expect(sum(BonusLotStatus.PENDING).toFixed(4)).toBe(wallet.pendingBonus.toFixed(4));
  expect(reservations.reduce((acc, r) => acc.plus(r.amount), ZERO).toFixed(4)).toBe(
    wallet.reservedBonus.toFixed(4),
  );
}

/** No bucket may ever go negative — the whole point of the hardening pass. */
export async function assertNoNegativeBalances(prisma: PrismaClient, walletId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  for (const [field, value] of Object.entries({
    availableBonus: wallet.availableBonus,
    pendingBonus: wallet.pendingBonus,
    reservedBonus: wallet.reservedBonus,
    lifetimeEarned: wallet.lifetimeEarned,
    lifetimeSpent: wallet.lifetimeSpent,
  })) {
    expect({ field, negative: value.isNegative() }).toEqual({ field, negative: false });
  }
}

/** Everything at once. Call this after every operation under test. */
export async function assertWalletIntegrity(prisma: PrismaClient, walletId: string) {
  await assertNoNegativeBalances(prisma, walletId);
  await assertLedgerEntriesWellFormed(prisma, walletId);
  await assertLedgerReconstructsWallet(prisma, walletId);
  await assertLotsBackBalances(prisma, walletId);
}
