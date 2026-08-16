import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BonusEntryType,
  BonusLotStatus,
  BonusReservationStatus,
  LedgerDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MONEY_MAX, parsePositiveMoney } from '../../common/utils/money';

type Tx = Prisma.TransactionClient;

export interface AccrueParams {
  walletId: string;
  type: BonusEntryType;
  amount: Decimal | number | string;
  sourceTransactionId?: string;
  /** Overrides the configured pending window; 0 = immediately available. */
  pendingHours?: number;
  metadata?: Record<string, unknown>;
}

export interface ReserveResult {
  reservationId: string;
  amount: Decimal;
  expiresAt: Date;
}

/** Signed effect of a ledger entry on each wallet bucket. */
interface BucketDelta {
  available?: Decimal;
  pending?: Decimal;
  reserved?: Decimal;
}

const ZERO = new Decimal(0);

/**
 * Domain service owning all bonus-point movement.
 *
 * Two rules govern this file:
 *
 *  1. Every mutation writes exactly one ledger entry describing its signed
 *     effect on each wallet bucket. Replaying the ledger reproduces the
 *     wallet exactly; `assertLedgerReconstructsWallet` in the test suite
 *     enforces that after every operation.
 *  2. Every externally-supplied amount goes through parseMoney(), which
 *     rejects negatives, NaN, Infinity, over-scale and over-range values.
 *     Controllers validate too, but this is the layer that must not be
 *     bypassable by a future internal caller.
 */
@Injectable()
export class BonusEngineService {
  private readonly logger = new Logger(BonusEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ── Ledger primitive ──────────────────────────────────────────────────

  /**
   * Refuses a mutation whose result would not fit the money column.
   *
   * Postgres would refuse it too, but as a 22003 on the way out — an
   * unhandled 500 rather than a clean 400 naming the balance that could not
   * hold it.
   */
  private async assertFits(
    client: Tx,
    walletId: string,
    deltas: Partial<Record<'available' | 'pending' | 'reserved' | 'lifetimeEarned', Decimal>>,
  ): Promise<void> {
    const wallet = await client.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: {
        availableBonus: true,
        pendingBonus: true,
        reservedBonus: true,
        lifetimeEarned: true,
      },
    });

    const checks: Array<[string, Decimal]> = [
      ['available', wallet.availableBonus.plus(deltas.available ?? ZERO)],
      ['pending', wallet.pendingBonus.plus(deltas.pending ?? ZERO)],
      ['reserved', wallet.reservedBonus.plus(deltas.reserved ?? ZERO)],
      ['lifetime earned', wallet.lifetimeEarned.plus(deltas.lifetimeEarned ?? ZERO)],
    ];

    for (const [bucket, value] of checks) {
      if (value.abs().greaterThan(MONEY_MAX)) {
        throw new BadRequestException(
          `This would take the wallet's ${bucket} balance past the maximum the platform can hold`,
        );
      }
    }
  }

  /**
   * The single write path into the ledger. Computes the resulting balance
   * from the wallet row that the caller has already updated, so the entry
   * and the wallet can never disagree.
   */
  private async writeLedger(
    client: Tx,
    params: {
      walletId: string;
      type: BonusEntryType;
      direction: LedgerDirection;
      amount: Decimal;
      delta: BucketDelta;
      relatedLotId?: string | null;
      relatedReservationId?: string | null;
      sourceTransactionId?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) {
    const wallet = await client.wallet.findUniqueOrThrow({
      where: { id: params.walletId },
      select: { availableBonus: true, pendingBonus: true, reservedBonus: true },
    });

    const available = params.delta.available ?? ZERO;
    const pending = params.delta.pending ?? ZERO;
    const reserved = params.delta.reserved ?? ZERO;

    // Guard the entry's own invariant before persisting it.
    const net = available.plus(pending).plus(reserved);
    const expected =
      params.direction === LedgerDirection.CREDIT
        ? params.amount
        : params.direction === LedgerDirection.DEBIT
          ? params.amount.negated()
          : ZERO;
    if (!net.equals(expected)) {
      throw new Error(
        `Ledger entry invariant violated for ${params.type}: deltas sum to ${net.toString()}, expected ${expected.toString()}`,
      );
    }


    return client.bonusLedgerEntry.create({
      data: {
        walletId: params.walletId,
        type: params.type,
        direction: params.direction,
        amount: params.amount,
        availableDelta: available,
        pendingDelta: pending,
        reservedDelta: reserved,
        balanceAfter: wallet.availableBonus.plus(wallet.pendingBonus).plus(wallet.reservedBonus),
        relatedLotId: params.relatedLotId ?? null,
        relatedReservationId: params.relatedReservationId ?? null,
        sourceTransactionId: params.sourceTransactionId ?? null,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  // ── Accrual ───────────────────────────────────────────────────────────

  /** Accrue new points into a lot that clears after the cooling-off window. */
  async accrue(params: AccrueParams, tx?: Tx) {
    const amount = parsePositiveMoney(params.amount, 'accrual amount');

    const run = async (client: Tx) => {
      const bonusConfig = this.config.get('bonus', { infer: true });
      const pendingHours = params.pendingHours ?? bonusConfig.pendingHours;
      if (!Number.isFinite(pendingHours) || pendingHours < 0) {
        throw new BadRequestException('pendingHours must be a non-negative number');
      }

      const now = new Date();
      const availableAt = new Date(now.getTime() + pendingHours * 3_600_000);
      const expiresAt = new Date(now);
      expiresAt.setMonth(expiresAt.getMonth() + bonusConfig.expiryMonths);
      if (expiresAt <= availableAt) {
        throw new BadRequestException('Bonus would expire before it becomes available');
      }

      const immediatelyAvailable = pendingHours <= 0;

      // Check the *resulting* balance before writing it.
      //
      // `parseMoney` checks the requested amount against Decimal(18,4)'s
      // maximum; nothing checked the sum. An accrual that pushed a wallet
      // past 10^14 therefore reached Postgres and came back as `numeric
      // field overflow` — a 500 from a request that was refusable on sight.
      //
      // The first version of this guard sat in `writeLedger`, which runs
      // *after* the wallet update, so the overflow still happened first and
      // the test caught it. Order matters more than placement here.
      await this.assertFits(client, params.walletId, {
        [immediatelyAvailable ? 'available' : 'pending']: amount,
        lifetimeEarned: amount,
      });

      const lot = await client.bonusLot.create({
        data: {
          walletId: params.walletId,
          type: params.type,
          status: immediatelyAvailable ? BonusLotStatus.AVAILABLE : BonusLotStatus.PENDING,
          originalAmount: amount,
          remainingAmount: amount,
          sourceTransactionId: params.sourceTransactionId,
          availableAt,
          expiresAt,
        },
      });

      await client.wallet.update({
        where: { id: params.walletId },
        data: {
          lifetimeEarned: { increment: amount },
          ...(immediatelyAvailable
            ? { availableBonus: { increment: amount } }
            : { pendingBonus: { increment: amount } }),
          version: { increment: 1 },
        },
      });

      await this.writeLedger(client, {
        walletId: params.walletId,
        type: params.type,
        direction: LedgerDirection.CREDIT,
        amount,
        delta: immediatelyAvailable ? { available: amount } : { pending: amount },
        relatedLotId: lot.id,
        sourceTransactionId: params.sourceTransactionId,
        metadata: params.metadata,
      });

      return lot;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  // ── Reservation lifecycle ─────────────────────────────────────────────

  /**
   * Places a hold against AVAILABLE lots (oldest-expiring first).
   *
   * This is a TRANSFER: points move available → reserved, the wallet total
   * is unchanged, and the ledger entry is NEUTRAL. The spend itself is
   * recorded once, at settlement.
   */
  async reserve(
    walletId: string,
    amount: Decimal | number | string,
    reasonTransactionId: string,
    holdSeconds?: number,
  ): Promise<ReserveResult> {
    const target = parsePositiveMoney(amount, 'reservation amount');

    return this.prisma.$transaction(
      async (tx) => {
        const lots = await tx.bonusLot.findMany({
          where: { walletId, status: BonusLotStatus.AVAILABLE, remainingAmount: { gt: 0 } },
          orderBy: { expiresAt: 'asc' },
        });

        const totalAvailable = lots.reduce((acc, l) => acc.plus(l.remainingAmount), ZERO);
        if (totalAvailable.lessThan(target)) {
          throw new BadRequestException('Insufficient available bonus balance');
        }

        const hold = holdSeconds ?? this.config.get('bonus', { infer: true }).reservationHoldSeconds;
        const expiresAt = new Date(Date.now() + hold * 1000);

        const reservation = await tx.bonusReservation.create({
          data: { walletId, amount: target, reasonTransactionId, expiresAt },
        });

        let remaining = target;
        for (const lot of lots) {
          if (remaining.lessThanOrEqualTo(0)) break;
          const allocation = Decimal.min(remaining, lot.remainingAmount);

          const updated = await tx.bonusLot.updateMany({
            where: { id: lot.id, remainingAmount: { gte: allocation } },
            data: { remainingAmount: { decrement: allocation } },
          });
          if (updated.count === 0) {
            throw new BadRequestException('Concurrent reservation conflict, please retry');
          }

          await tx.bonusReservationAllocation.create({
            data: { reservationId: reservation.id, lotId: lot.id, amount: allocation },
          });

          remaining = remaining.minus(allocation);
        }

        if (!remaining.isZero()) {
          throw new Error('Reservation could not be fully allocated');
        }

        await tx.wallet.update({
          where: { id: walletId },
          data: {
            availableBonus: { decrement: target },
            reservedBonus: { increment: target },
            version: { increment: 1 },
          },
        });

        await this.writeLedger(tx, {
          walletId,
          type: BonusEntryType.RESERVE_HOLD,
          direction: LedgerDirection.NEUTRAL,
          amount: target,
          delta: { available: target.negated(), reserved: target },
          relatedReservationId: reservation.id,
          sourceTransactionId: reasonTransactionId,
        });

        return { reservationId: reservation.id, amount: target, expiresAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Finalises a hold as spent. This is the only place a redemption DEBIT is
   * written — the points leave the wallet here and nowhere else.
   */
  async settleReservation(reservationId: string, tx?: Tx) {
    const run = async (client: Tx) => {
      const reservation = await client.bonusReservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { allocations: true },
      });
      if (reservation.status !== BonusReservationStatus.ACTIVE) {
        throw new BadRequestException(`Reservation is not active (status: ${reservation.status})`);
      }

      // A lot whose remainder is now zero has been fully spent.
      for (const allocation of reservation.allocations) {
        const lot = await client.bonusLot.findUniqueOrThrow({ where: { id: allocation.lotId } });
        if (lot.remainingAmount.isZero() && lot.status === BonusLotStatus.AVAILABLE) {
          await client.bonusLot.update({
            where: { id: lot.id },
            data: { status: BonusLotStatus.CONSUMED },
          });
        }
      }

      await client.bonusReservation.update({
        where: { id: reservationId },
        data: { status: BonusReservationStatus.SETTLED, settledAt: new Date() },
      });

      await client.wallet.update({
        where: { id: reservation.walletId },
        data: {
          reservedBonus: { decrement: reservation.amount },
          lifetimeSpent: { increment: reservation.amount },
          version: { increment: 1 },
        },
      });

      const redemptionType = await this.redemptionTypeFor(client, reservation.reasonTransactionId);
      await this.writeLedger(client, {
        walletId: reservation.walletId,
        type: redemptionType,
        direction: LedgerDirection.DEBIT,
        amount: reservation.amount,
        delta: { reserved: reservation.amount.negated() },
        relatedReservationId: reservation.id,
        sourceTransactionId: reservation.reasonTransactionId,
      });

      return reservation;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /** Returns a hold to available. TRANSFER — the total is unchanged. */
  async releaseReservation(reservationId: string, reason: string, tx?: Tx) {
    const run = async (client: Tx) => {
      const reservation = await client.bonusReservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { allocations: true },
      });
      if (reservation.status !== BonusReservationStatus.ACTIVE) {
        throw new BadRequestException(`Reservation is not active (status: ${reservation.status})`);
      }

      for (const allocation of reservation.allocations) {
        await client.bonusLot.update({
          where: { id: allocation.lotId },
          data: {
            remainingAmount: { increment: allocation.amount },
            status: BonusLotStatus.AVAILABLE,
          },
        });
      }

      await client.bonusReservation.update({
        where: { id: reservationId },
        data: { status: BonusReservationStatus.RELEASED, releasedAt: new Date() },
      });

      await client.wallet.update({
        where: { id: reservation.walletId },
        data: {
          reservedBonus: { decrement: reservation.amount },
          availableBonus: { increment: reservation.amount },
          version: { increment: 1 },
        },
      });

      await this.writeLedger(client, {
        walletId: reservation.walletId,
        type: BonusEntryType.RESERVE_RELEASE,
        direction: LedgerDirection.NEUTRAL,
        amount: reservation.amount,
        delta: { reserved: reservation.amount.negated(), available: reservation.amount },
        relatedReservationId: reservation.id,
        sourceTransactionId: reservation.reasonTransactionId,
        metadata: { reason },
      });

      return reservation;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /**
   * Undoes a settlement, returning spent points to the customer.
   *
   * `releaseReservation` only accepts an ACTIVE hold, so a saga that failed
   * *after* settling had no way back: the rollback threw, the caller logged
   * it, and the customer was left with the points debited against a
   * transaction marked FAILED. This is the compensating action for that leg.
   *
   * Idempotent — a second call finds the REVERSAL entry and does nothing,
   * so a retried rollback cannot mint points.
   */
  async reverseSettlement(reservationId: string, reason: string, tx?: Tx) {
    const run = async (client: Tx) => {
      const reservation = await client.bonusReservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { allocations: true },
      });
      if (reservation.status !== BonusReservationStatus.SETTLED) {
        throw new BadRequestException(
          `Only a settled reservation can be reversed (status: ${reservation.status})`,
        );
      }

      const alreadyReversed = await client.bonusLedgerEntry.findFirst({
        where: { relatedReservationId: reservationId, type: BonusEntryType.REVERSAL },
        select: { id: true },
      });
      if (alreadyReversed) return reservation;

      // Restore the very lots the spend consumed, so the returned points keep
      // their original expiry instead of silently gaining a fresh lifetime.
      // A lot whose expiry has since passed is put back as AVAILABLE and the
      // next expiry sweep debits it properly — the same path release takes.
      for (const allocation of reservation.allocations) {
        await client.bonusLot.update({
          where: { id: allocation.lotId },
          data: {
            remainingAmount: { increment: allocation.amount },
            status: BonusLotStatus.AVAILABLE,
          },
        });
      }

      await client.wallet.update({
        where: { id: reservation.walletId },
        data: {
          availableBonus: { increment: reservation.amount },
          lifetimeSpent: { decrement: reservation.amount },
          version: { increment: 1 },
        },
      });

      await this.writeLedger(client, {
        walletId: reservation.walletId,
        type: BonusEntryType.REVERSAL,
        direction: LedgerDirection.CREDIT,
        amount: reservation.amount,
        delta: { available: reservation.amount },
        relatedReservationId: reservation.id,
        sourceTransactionId: reservation.reasonTransactionId,
        metadata: { reason, reversedFrom: 'settlement' },
      });

      return reservation;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /**
   * Rollback entry point for the payment sagas: returns a hold to the
   * customer whatever stage it reached. Callers must not have to know
   * whether their failure happened before or after settlement.
   */
  async compensateReservation(reservationId: string, reason: string) {
    const reservation = await this.prisma.bonusReservation.findUniqueOrThrow({
      where: { id: reservationId },
      select: { status: true },
    });

    switch (reservation.status) {
      case BonusReservationStatus.ACTIVE:
        await this.releaseReservation(reservationId, reason);
        return 'released' as const;
      case BonusReservationStatus.SETTLED:
        await this.reverseSettlement(reservationId, reason);
        return 'reversed' as const;
      default:
        // Already RELEASED or EXPIRED — the points are back with the customer.
        return 'noop' as const;
    }
  }

  /**
   * Undoes an accrual whose transaction did not complete.
   *
   * Only the portion still unspent is clawed back: if the customer has
   * already redeemed part of the lot, taking it back would drive the wallet
   * negative. The shortfall is recorded on the entry rather than forced.
   *
   * `maxAmount` caps how much is taken, which is what a partial refund needs
   * — refunding half a purchase should reclaim half its points, not all of
   * them. Omitted, the whole unspent remainder goes, which is what a full
   * reversal needs.
   */
  async reverseAccrualLot(lotId: string, reason: string, maxAmount?: Decimal) {
    return this.prisma.$transaction(
      async (tx) => {
        const lot = await tx.bonusLot.findUniqueOrThrow({ where: { id: lotId } });
        if (lot.status === BonusLotStatus.EXPIRED || lot.remainingAmount.isZero()) {
          return null;
        }

        const amount = maxAmount
          ? Decimal.min(maxAmount, lot.remainingAmount)
          : lot.remainingAmount;
        if (amount.lessThanOrEqualTo(0)) return null;
        const drained = amount.equals(lot.remainingAmount);
        const wasPending = lot.status === BonusLotStatus.PENDING;

        await tx.bonusLot.update({
          where: { id: lot.id },
          data: {
            remainingAmount: { decrement: amount },
            ...(drained ? { status: BonusLotStatus.CONSUMED } : {}),
          },
        });

        await tx.wallet.update({
          where: { id: lot.walletId },
          data: {
            ...(wasPending
              ? { pendingBonus: { decrement: amount } }
              : { availableBonus: { decrement: amount } }),
            lifetimeEarned: { decrement: amount },
            version: { increment: 1 },
          },
        });

        await this.writeLedger(tx, {
          walletId: lot.walletId,
          type: BonusEntryType.REVERSAL,
          direction: LedgerDirection.DEBIT,
          amount,
          delta: wasPending ? { pending: amount.negated() } : { available: amount.negated() },
          relatedLotId: lot.id,
          sourceTransactionId: lot.sourceTransactionId,
          metadata: {
            reason,
            reversedFrom: 'accrual',
            clawedBack: amount.toString(),
            accrued: lot.originalAmount.toString(),
          },
        });

        return amount;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── Scheduled maintenance ─────────────────────────────────────────────

  /** Promotes PENDING lots whose cooling-off window has elapsed. TRANSFER. */
  async promotePendingLots(now = new Date()) {
    const lots = await this.prisma.bonusLot.findMany({
      where: { status: BonusLotStatus.PENDING, availableAt: { lte: now } },
      select: { id: true, walletId: true },
    });

    let promoted = 0;
    for (const candidate of lots) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Re-read inside the transaction: the amount may have changed.
          const lot = await tx.bonusLot.findUnique({ where: { id: candidate.id } });
          if (!lot || lot.status !== BonusLotStatus.PENDING) return;

          const moved = lot.remainingAmount;
          await tx.bonusLot.update({
            where: { id: lot.id },
            data: { status: BonusLotStatus.AVAILABLE },
          });
          if (moved.isZero()) return;

          await tx.wallet.update({
            where: { id: lot.walletId },
            data: {
              pendingBonus: { decrement: moved },
              availableBonus: { increment: moved },
              version: { increment: 1 },
            },
          });

          await this.writeLedger(tx, {
            walletId: lot.walletId,
            type: BonusEntryType.PENDING_PROMOTION,
            direction: LedgerDirection.NEUTRAL,
            amount: moved,
            delta: { pending: moved.negated(), available: moved },
            relatedLotId: lot.id,
          });
          promoted += 1;
        });
      } catch (err) {
        this.logger.error(`Failed to promote lot ${candidate.id}`, err as Error);
      }
    }

    if (promoted > 0) this.logger.log(`Promoted ${promoted} bonus lot(s) to AVAILABLE`);
    return promoted;
  }

  /** Expires lots past expiresAt. Points leave the wallet — DEBIT. */
  async expireLots(now = new Date()) {
    const candidates = await this.prisma.bonusLot.findMany({
      where: {
        status: { in: [BonusLotStatus.AVAILABLE, BonusLotStatus.PENDING] },
        expiresAt: { lte: now },
        remainingAmount: { gt: 0 },
      },
      select: { id: true },
    });

    let expired = 0;
    for (const candidate of candidates) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // Re-read inside the transaction so a concurrent reservation
            // cannot make us decrement an amount that already moved.
            const lot = await tx.bonusLot.findUnique({ where: { id: candidate.id } });
            if (
              !lot ||
              lot.remainingAmount.isZero() ||
              (lot.status !== BonusLotStatus.AVAILABLE && lot.status !== BonusLotStatus.PENDING)
            ) {
              return;
            }

            const amount = lot.remainingAmount;
            const wasAvailable = lot.status === BonusLotStatus.AVAILABLE;

            await tx.bonusLot.update({
              where: { id: lot.id },
              data: { status: BonusLotStatus.EXPIRED, remainingAmount: 0 },
            });

            await tx.wallet.update({
              where: { id: lot.walletId },
              data: {
                ...(wasAvailable
                  ? { availableBonus: { decrement: amount } }
                  : { pendingBonus: { decrement: amount } }),
                version: { increment: 1 },
              },
            });

            await this.writeLedger(tx, {
              walletId: lot.walletId,
              type: BonusEntryType.EXPIRY,
              direction: LedgerDirection.DEBIT,
              amount,
              delta: wasAvailable ? { available: amount.negated() } : { pending: amount.negated() },
              relatedLotId: lot.id,
              metadata: { bucket: wasAvailable ? 'available' : 'pending' },
            });
            expired += 1;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        this.logger.error(`Failed to expire lot ${candidate.id}`, err as Error);
      }
    }

    if (expired > 0) this.logger.log(`Expired ${expired} bonus lot(s)`);
    return expired;
  }

  /**
   * Releases holds whose window elapsed without being settled.
   *
   * Without this, a process that dies between reserve() and settle() strands
   * the points in `reserved` permanently — invisible to the customer and
   * unrecoverable without manual intervention.
   */
  async releaseExpiredReservations(now = new Date()) {
    const stale = await this.prisma.bonusReservation.findMany({
      where: { status: BonusReservationStatus.ACTIVE, expiresAt: { lte: now } },
      select: { id: true },
    });

    let released = 0;
    for (const { id } of stale) {
      try {
        await this.releaseReservation(id, 'reservation_expired');
        released += 1;
      } catch (err) {
        this.logger.error(`Failed to release expired reservation ${id}`, err as Error);
      }
    }

    if (released > 0) this.logger.warn(`Released ${released} expired bonus reservation(s)`);
    return released;
  }

  // ── Administrative ────────────────────────────────────────────────────

  /**
   * Admin credit/debit. Both directions take a strictly positive amount.
   *
   * ── Why there is a ceiling ────────────────────────────────────────────
   *
   * This is the only path on the platform where a caller-supplied number
   * becomes loyalty points without anything bounding it. A payment's accrual
   * is bounded by what the acquirer actually captured; an EV session by the
   * physical limits on a meter; a referral by a configured constant. Here a
   * single request minted whatever it asked for, and points are a liability
   * the business owes.
   *
   * Two ways that goes wrong, neither of them exotic: an administrator types
   * an extra three zeros into a goodwill credit, or one compromised admin
   * session mints a balance and walks it out through partners. Before this,
   * both succeeded silently — and an adjustment large enough to overflow the
   * column crashed with a 500 rather than being refused, because the input
   * was checked against the column's maximum while the *resulting balance*
   * was not.
   *
   * The ceiling is per adjustment and configurable, not a hard constant: a
   * legitimate large correction still exists, it just has to be made
   * deliberately by someone who raised the limit, rather than by accident.
   */
  async manualAdjustment(
    walletId: string,
    amount: Decimal | number | string,
    direction: LedgerDirection,
    reason: string,
  ) {
    const target = parsePositiveMoney(amount, 'adjustment amount');

    const ceiling = new Decimal(
      this.config.get('bonus.manualAdjustmentMax', { infer: true }),
    );
    if (target.greaterThan(ceiling)) {
      throw new BadRequestException(
        `A single manual adjustment is limited to ${ceiling.toFixed(0)} points. ` +
          'Raise BONUS_MANUAL_ADJUSTMENT_MAX deliberately if a larger correction is genuinely needed.',
      );
    }

    if (direction === LedgerDirection.CREDIT) {
      return this.accrue({
        walletId,
        type: BonusEntryType.ACCRUAL_MANUAL_ADJUSTMENT,
        amount: target,
        pendingHours: 0,
        metadata: { reason },
      });
    }
    if (direction !== LedgerDirection.DEBIT) {
      throw new BadRequestException('Manual adjustment must be CREDIT or DEBIT');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const lots = await tx.bonusLot.findMany({
          where: { walletId, status: BonusLotStatus.AVAILABLE, remainingAmount: { gt: 0 } },
          orderBy: { expiresAt: 'asc' },
        });
        const totalAvailable = lots.reduce((acc, l) => acc.plus(l.remainingAmount), ZERO);
        if (totalAvailable.lessThan(target)) {
          throw new BadRequestException('Insufficient available balance for manual debit');
        }

        let remaining = target;
        for (const lot of lots) {
          if (remaining.lessThanOrEqualTo(0)) break;
          const allocation = Decimal.min(remaining, lot.remainingAmount);
          const updated = await tx.bonusLot.updateMany({
            where: { id: lot.id, remainingAmount: { gte: allocation } },
            data: {
              remainingAmount: { decrement: allocation },
              ...(allocation.equals(lot.remainingAmount)
                ? { status: BonusLotStatus.CONSUMED }
                : {}),
            },
          });
          if (updated.count === 0) {
            throw new BadRequestException('Concurrent adjustment conflict, please retry');
          }
          remaining = remaining.minus(allocation);
        }

        await tx.wallet.update({
          where: { id: walletId },
          data: {
            availableBonus: { decrement: target },
            lifetimeSpent: { increment: target },
            version: { increment: 1 },
          },
        });

        await this.writeLedger(tx, {
          walletId,
          type: BonusEntryType.ACCRUAL_MANUAL_ADJUSTMENT,
          direction: LedgerDirection.DEBIT,
          amount: target,
          delta: { available: target.negated() },
          metadata: { reason },
        });

        return tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Redemptions are attributed to what the points were actually spent on,
   * so a ledger reader can tell a coffee payment from a charging session
   * without joining back to `transactions`.
   */
  private async redemptionTypeFor(
    client: Tx,
    transactionId: string | null,
  ): Promise<BonusEntryType> {
    if (!transactionId) return BonusEntryType.REDEMPTION_QR_PAYMENT;
    const transaction = await client.transaction.findUnique({
      where: { id: transactionId },
      select: { type: true },
    });
    if (transaction?.type === 'EV_CHARGING') return BonusEntryType.REDEMPTION_EV_CHARGING;
    if (transaction?.type === 'PARTNER_PURCHASE') return BonusEntryType.REDEMPTION_PARTNER_PURCHASE;
    return BonusEntryType.REDEMPTION_QR_PAYMENT;
  }

  /** Exposed for reconciliation tooling and tests. */
  static readonly VALUE_TYPES: BonusEntryType[] = [
    BonusEntryType.ACCRUAL_PURCHASE,
    BonusEntryType.ACCRUAL_REFERRAL,
    BonusEntryType.ACCRUAL_PROMOTION,
    BonusEntryType.ACCRUAL_MANUAL_ADJUSTMENT,
    BonusEntryType.ACCRUAL_DEFERRED,
    BonusEntryType.REDEMPTION_QR_PAYMENT,
    BonusEntryType.REDEMPTION_EV_CHARGING,
    BonusEntryType.REDEMPTION_PARTNER_PURCHASE,
    BonusEntryType.EXPIRY,
    BonusEntryType.REVERSAL,
  ];

  static readonly TRANSFER_TYPES: BonusEntryType[] = [
    BonusEntryType.RESERVE_HOLD,
    BonusEntryType.RESERVE_RELEASE,
    BonusEntryType.PENDING_PROMOTION,
  ];
}
