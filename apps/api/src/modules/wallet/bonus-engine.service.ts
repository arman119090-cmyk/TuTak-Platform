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

/**
 * Domain service owning all bonus-point money movement. Every mutation here
 * runs inside a Prisma transaction (caller-supplied or self-managed) and
 * writes an immutable BonusLedgerEntry alongside it — the ledger is the
 * source of truth; Wallet's balance columns are a transactionally-consistent
 * read cache over it.
 */
@Injectable()
export class BonusEngineService {
  private readonly logger = new Logger(BonusEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Accrue new bonus points into a PENDING lot that clears after the cooling-off window. */
  async accrue(params: AccrueParams, tx?: Tx) {
    const run = async (client: Tx) => {
      const amount = new Decimal(params.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Accrual amount must be positive');
      }

      const bonusConfig = this.config.get('bonus', { infer: true });
      const pendingHours = params.pendingHours ?? bonusConfig.pendingHours;
      const expiryMonths = bonusConfig.expiryMonths;
      const now = new Date();
      const availableAt = new Date(now.getTime() + pendingHours * 3_600_000);
      const expiresAt = new Date(now);
      expiresAt.setMonth(expiresAt.getMonth() + expiryMonths);

      const initialStatus = pendingHours <= 0 ? BonusLotStatus.AVAILABLE : BonusLotStatus.PENDING;

      const lot = await client.bonusLot.create({
        data: {
          walletId: params.walletId,
          type: params.type,
          status: initialStatus,
          originalAmount: amount,
          remainingAmount: amount,
          sourceTransactionId: params.sourceTransactionId,
          availableAt,
          expiresAt,
        },
      });

      const wallet = await client.wallet.update({
        where: { id: params.walletId },
        data: {
          lifetimeEarned: { increment: amount },
          ...(initialStatus === BonusLotStatus.AVAILABLE
            ? { availableBonus: { increment: amount } }
            : { pendingBonus: { increment: amount } }),
          version: { increment: 1 },
        },
      });

      await client.bonusLedgerEntry.create({
        data: {
          walletId: params.walletId,
          type: params.type,
          direction: LedgerDirection.CREDIT,
          amount,
          balanceAfter: wallet.availableBonus.plus(wallet.pendingBonus),
          relatedLotId: lot.id,
          sourceTransactionId: params.sourceTransactionId,
          metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue,
        },
      });

      return lot;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /**
   * Places a hold against AVAILABLE lots (oldest-expiring first) for the
   * given amount, so it cannot be double-spent by a concurrent request.
   */
  async reserve(
    walletId: string,
    amount: Decimal | number | string,
    reasonTransactionId: string,
    holdSeconds?: number,
  ): Promise<ReserveResult> {
    const target = new Decimal(amount);
    if (target.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Reservation amount must be positive');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const lots = await tx.bonusLot.findMany({
          where: { walletId, status: BonusLotStatus.AVAILABLE, remainingAmount: { gt: 0 } },
          orderBy: { expiresAt: 'asc' },
        });

        const totalAvailable = lots.reduce((acc, l) => acc.plus(l.remainingAmount), new Decimal(0));
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

        await tx.wallet.update({
          where: { id: walletId },
          data: {
            availableBonus: { decrement: target },
            reservedBonus: { increment: target },
            version: { increment: 1 },
          },
        });

        await tx.bonusLedgerEntry.create({
          data: {
            walletId,
            type: BonusEntryType.REDEMPTION_QR_PAYMENT,
            direction: LedgerDirection.DEBIT,
            amount: target,
            balanceAfter: totalAvailable.minus(target),
            relatedReservationId: reservation.id,
            sourceTransactionId: reasonTransactionId,
            metadata: { phase: 'reserved' } as Prisma.InputJsonValue,
          },
        });

        return { reservationId: reservation.id, amount: target, expiresAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Finalizes a reservation as spent — points leave reservedBonus permanently. */
  async settleReservation(reservationId: string, tx?: Tx) {
    const run = async (client: Tx) => {
      const reservation = await client.bonusReservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { allocations: true },
      });
      if (reservation.status !== BonusReservationStatus.ACTIVE) {
        throw new BadRequestException(`Reservation is not active (status: ${reservation.status})`);
      }

      for (const allocation of reservation.allocations) {
        const lot = await client.bonusLot.findUniqueOrThrow({ where: { id: allocation.lotId } });
        if (lot.remainingAmount.equals(0)) {
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

      const wallet = await client.wallet.update({
        where: { id: reservation.walletId },
        data: {
          reservedBonus: { decrement: reservation.amount },
          lifetimeSpent: { increment: reservation.amount },
          version: { increment: 1 },
        },
      });

      await client.bonusLedgerEntry.create({
        data: {
          walletId: reservation.walletId,
          type: BonusEntryType.REDEMPTION_QR_PAYMENT,
          direction: LedgerDirection.DEBIT,
          amount: reservation.amount,
          balanceAfter: wallet.availableBonus,
          relatedReservationId: reservation.id,
          sourceTransactionId: reservation.reasonTransactionId,
          metadata: { phase: 'settled' } as Prisma.InputJsonValue,
        },
      });

      return reservation;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /** Releases a hold (payment failed/cancelled/expired) and returns points to AVAILABLE. */
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

      const wallet = await client.wallet.update({
        where: { id: reservation.walletId },
        data: {
          reservedBonus: { decrement: reservation.amount },
          availableBonus: { increment: reservation.amount },
          version: { increment: 1 },
        },
      });

      await client.bonusLedgerEntry.create({
        data: {
          walletId: reservation.walletId,
          type: BonusEntryType.REVERSAL,
          direction: LedgerDirection.CREDIT,
          amount: reservation.amount,
          balanceAfter: wallet.availableBonus,
          relatedReservationId: reservation.id,
          sourceTransactionId: reservation.reasonTransactionId,
          metadata: { reason } as Prisma.InputJsonValue,
        },
      });

      return reservation;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /** Scheduled: promotes PENDING lots whose cooling-off window has elapsed. */
  async promotePendingLots(now = new Date()) {
    const lots = await this.prisma.bonusLot.findMany({
      where: { status: BonusLotStatus.PENDING, availableAt: { lte: now } },
    });

    for (const lot of lots) {
      await this.prisma.$transaction(async (tx) => {
        await tx.bonusLot.update({ where: { id: lot.id }, data: { status: BonusLotStatus.AVAILABLE } });
        await tx.wallet.update({
          where: { id: lot.walletId },
          data: {
            pendingBonus: { decrement: lot.remainingAmount },
            availableBonus: { increment: lot.remainingAmount },
            version: { increment: 1 },
          },
        });
      });
    }

    if (lots.length > 0) {
      this.logger.log(`Promoted ${lots.length} bonus lot(s) from PENDING to AVAILABLE`);
    }
    return lots.length;
  }

  /** Scheduled: expires AVAILABLE (or still-PENDING) lots past their expiresAt. */
  async expireLots(now = new Date()) {
    const lots = await this.prisma.bonusLot.findMany({
      where: {
        status: { in: [BonusLotStatus.AVAILABLE, BonusLotStatus.PENDING] },
        expiresAt: { lte: now },
        remainingAmount: { gt: 0 },
      },
    });

    for (const lot of lots) {
      await this.prisma.$transaction(async (tx) => {
        const wasAvailable = lot.status === BonusLotStatus.AVAILABLE;
        await tx.bonusLot.update({
          where: { id: lot.id },
          data: { status: BonusLotStatus.EXPIRED, remainingAmount: 0 },
        });

        const wallet = await tx.wallet.update({
          where: { id: lot.walletId },
          data: {
            ...(wasAvailable
              ? { availableBonus: { decrement: lot.remainingAmount } }
              : { pendingBonus: { decrement: lot.remainingAmount } }),
            version: { increment: 1 },
          },
        });

        await tx.bonusLedgerEntry.create({
          data: {
            walletId: lot.walletId,
            type: BonusEntryType.EXPIRY,
            direction: LedgerDirection.DEBIT,
            amount: lot.remainingAmount,
            balanceAfter: wallet.availableBonus,
            relatedLotId: lot.id,
            metadata: { reason: 'lot_expired' } as Prisma.InputJsonValue,
          },
        });
      });
    }

    if (lots.length > 0) {
      this.logger.log(`Expired ${lots.length} bonus lot(s)`);
    }
    return lots.length;
  }

  /** Admin-initiated manual credit/debit adjustment, always fully audited. */
  async manualAdjustment(
    walletId: string,
    amount: Decimal | number | string,
    direction: LedgerDirection,
    reason: string,
  ) {
    if (direction === LedgerDirection.CREDIT) {
      return this.accrue({
        walletId,
        type: BonusEntryType.ACCRUAL_MANUAL_ADJUSTMENT,
        amount,
        pendingHours: 0,
        metadata: { reason },
      });
    }

    const target = new Decimal(amount);
    return this.prisma.$transaction(async (tx) => {
      const lots = await tx.bonusLot.findMany({
        where: { walletId, status: BonusLotStatus.AVAILABLE, remainingAmount: { gt: 0 } },
        orderBy: { expiresAt: 'asc' },
      });
      const totalAvailable = lots.reduce((acc, l) => acc.plus(l.remainingAmount), new Decimal(0));
      if (totalAvailable.lessThan(target)) {
        throw new BadRequestException('Insufficient available balance for manual debit');
      }

      let remaining = target;
      for (const lot of lots) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const allocation = Decimal.min(remaining, lot.remainingAmount);
        await tx.bonusLot.update({
          where: { id: lot.id },
          data: { remainingAmount: { decrement: allocation } },
        });
        remaining = remaining.minus(allocation);
      }

      const wallet = await tx.wallet.update({
        where: { id: walletId },
        data: { availableBonus: { decrement: target }, version: { increment: 1 } },
      });

      await tx.bonusLedgerEntry.create({
        data: {
          walletId,
          type: BonusEntryType.ACCRUAL_MANUAL_ADJUSTMENT,
          direction: LedgerDirection.DEBIT,
          amount: target,
          balanceAfter: wallet.availableBonus,
          metadata: { reason } as Prisma.InputJsonValue,
        },
      });

      return wallet;
    });
  }
}
