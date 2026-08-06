import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BonusEntryType,
  EvConnectorStatus,
  EvReservationStatus,
  EvSessionStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseMoney } from '../../common/utils/money';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionsService } from '../transactions/transactions.service';
import { OCPI_ADAPTER, OcpiAdapter } from './ocpi/ocpi-adapter.interface';
import { StartSessionDto, StopSessionDto } from './dto/start-session.dto';

@Injectable()
export class EvSessionsService {
  private readonly logger = new Logger(EvSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly walletService: WalletService,
    private readonly transactionsService: TransactionsService,
    @Inject(OCPI_ADAPTER) private readonly ocpiAdapter: OcpiAdapter,
  ) {}

  async start(dto: StartSessionDto, userId: string) {
    const connector = await this.prisma.evConnector.findUnique({ where: { id: dto.connectorId } });
    if (!connector) throw new NotFoundException('Connector not found');

    if (dto.reservationId) {
      const reservation = await this.prisma.evReservation.findUnique({ where: { id: dto.reservationId } });
      if (!reservation || reservation.userId !== userId || reservation.connectorId !== dto.connectorId) {
        throw new BadRequestException('Reservation does not match this user/connector');
      }
      if (reservation.status !== EvReservationStatus.CONFIRMED) {
        throw new BadRequestException('Reservation is not confirmed');
      }
    } else if (connector.status !== EvConnectorStatus.AVAILABLE) {
      throw new BadRequestException('Connector is not available');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.evConnector.update({
        where: { id: connector.id },
        data: { status: EvConnectorStatus.CHARGING },
      });

      const session = await tx.evSession.create({
        data: {
          connectorId: connector.id,
          userId,
          reservationId: dto.reservationId,
          status: EvSessionStatus.CHARGING,
          startedAt: new Date(),
          energyKwh: 0,
        },
      });

      if (dto.reservationId) {
        await tx.evReservation.update({
          where: { id: dto.reservationId },
          data: { status: EvReservationStatus.FULFILLED },
        });
      }

      if (connector.ocpiEvseUid) {
        const result = await this.ocpiAdapter.startRemoteSession({
          ocpiEvseUid: connector.ocpiEvseUid,
          userId,
          localSessionId: session.id,
        });
        if (!result.accepted) {
          throw new BadRequestException('Roaming CPO rejected the remote start command');
        }
      }

      return session;
    });
  }

  /** OCPP-style meter value ingestion — a real charger telemetry stream would call this. */
  async reportMeterValue(sessionId: string, energyKwh: string) {
    const reading = parseMoney(energyKwh, 'energyKwh');
    const session = await this.prisma.evSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== EvSessionStatus.CHARGING) {
      throw new BadRequestException('Session is not currently charging');
    }
    // A meter is monotonic: energy delivered can only increase within a
    // session. Accepting a lower reading would let a caller reduce the bill
    // after the fact.
    if (session.energyKwh && reading.lessThan(session.energyKwh)) {
      throw new BadRequestException('Meter reading cannot decrease');
    }
    return this.prisma.evSession.update({
      where: { id: sessionId },
      data: { energyKwh: reading },
    });
  }

  async stop(sessionId: string, userId: string, dto: StopSessionDto) {
    const session = await this.prisma.evSession.findUnique({
      where: { id: sessionId },
      include: { connector: { include: { station: true } } },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Charging session not found');
    }
    if (session.status !== EvSessionStatus.CHARGING) {
      throw new BadRequestException(`Session cannot be stopped (status: ${session.status})`);
    }

    const energyKwh = session.energyKwh ?? new Decimal(0);
    const cost = energyKwh.times(session.connector.pricePerKwh);
    // Same negative-amount hole as the QR path: a negative bonus turned
    // `cost.minus(bonus)` into an addition and inflated the accrual base.
    const bonusToApply = dto.bonusAmountToApply
      ? parseMoney(dto.bonusAmountToApply, 'bonusAmountToApply')
      : new Decimal(0);
    if (bonusToApply.greaterThan(cost)) {
      throw new BadRequestException('Bonus applied cannot exceed the session cost');
    }

    const transaction = await this.transactionsService.create({
      userId,
      partnerId: session.connector.station.partnerId,
      type: TransactionType.EV_CHARGING,
      amount: cost,
      bonusAppliedAmount: bonusToApply,
      description: `EV charging at ${session.connector.station.name}`,
      metadata: { sessionId: session.id, energyKwh: energyKwh.toString() },
    });

    let reservationId: string | null = null;
    let accruedLotId: string | null = null;
    try {
      if (bonusToApply.greaterThan(0)) {
        const walletId = await this.walletService.getWalletIdForUser(userId);
        const reservation = await this.bonusEngine.reserve(walletId, bonusToApply, transaction.id);
        reservationId = reservation.reservationId;
        await this.bonusEngine.settleReservation(reservationId);
      }

      if (session.connector.ocpiEvseUid) {
        await this.ocpiAdapter.stopRemoteSession({ ocpiSessionId: session.ocpiCdrId ?? session.id });
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.evConnector.update({
          where: { id: session.connectorId },
          data: { status: EvConnectorStatus.AVAILABLE },
        });
        await tx.evSession.update({
          where: { id: session.id },
          data: {
            status: EvSessionStatus.COMPLETED,
            stoppedAt: new Date(),
            energyKwh,
            cost,
            transactionId: transaction.id,
          },
        });
        await tx.evCdr.create({
          data: {
            sessionId: session.id,
            totalEnergy: energyKwh,
            totalCost: cost,
            totalTimeSec: session.startedAt
              ? Math.max(0, Math.round((Date.now() - session.startedAt.getTime()) / 1000))
              : 0,
          },
        });
      });

      let bonusEarned = new Decimal(0);
      const rateBps = session.connector.station.partnerId
        ? (await this.prisma.partner.findUnique({ where: { id: session.connector.station.partnerId } }))
            ?.bonusAccrualRateBps
        : undefined;
      if (rateBps) {
        const paidPortion = cost.minus(bonusToApply);
        bonusEarned = paidPortion.times(rateBps).dividedBy(10_000);
        if (bonusEarned.greaterThan(0)) {
          const walletId = await this.walletService.getWalletIdForUser(userId);
          const lot = await this.bonusEngine.accrue({
            walletId,
            type: BonusEntryType.ACCRUAL_PURCHASE,
            amount: bonusEarned,
            sourceTransactionId: transaction.id,
          });
          accruedLotId = lot.id;
        }
      }

      const completed = await this.transactionsService.markCompleted(transaction.id, {
        bonusEarnedAmount: bonusEarned,
      });

      return {
        transactionId: completed.id,
        energyKwh: energyKwh.toString(),
        cost: cost.toString(),
        bonusApplied: bonusToApply.toString(),
        bonusEarned: bonusEarned.toString(),
      };
    } catch (err) {
      // A settled reservation is already spent and must be reversed rather
      // than released; an active one is simply returned to available.
      // compensateReservation picks the right leg — release alone used to
      // throw here and leave the customer's points spent on a FAILED session.
      if (reservationId) {
        await this.bonusEngine
          .compensateReservation(reservationId, 'ev_stop_failed')
          .catch((e) =>
            this.logger.error('Failed to compensate bonus reservation after EV stop failure', e),
          );
      }
      if (accruedLotId) {
        await this.bonusEngine
          .reverseAccrualLot(accruedLotId, 'ev_stop_failed')
          .catch((e) =>
            this.logger.error('Failed to reverse bonus accrual after EV stop failure', e),
          );
      }

      // Without this the connector stayed CHARGING forever: the station was
      // permanently unusable and the partner silently lost the revenue.
      await this.prisma
        .$transaction(async (tx) => {
          await tx.evConnector.update({
            where: { id: session.connectorId },
            data: { status: EvConnectorStatus.AVAILABLE },
          });
          await tx.evSession.update({
            where: { id: session.id },
            data: { status: EvSessionStatus.INVALID, stoppedAt: new Date() },
          });
        })
        .catch((e) =>
          this.logger.error(
            `Failed to free connector ${session.connectorId} after EV stop failure`,
            e,
          ),
        );

      await this.transactionsService.markFailed(
        transaction.id,
        err instanceof Error ? err.message : 'unknown_error',
      );
      throw err;
    }
  }

  historyForUser(userId: string) {
    return this.prisma.evSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { connector: { include: { station: true } }, cdr: true },
    });
  }
}
