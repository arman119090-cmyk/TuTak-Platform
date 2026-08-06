import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EvConnectorStatus, EvReservationStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Injectable()
export class EvReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReservationDto, userId: string) {
    const holdMinutes = dto.holdMinutes ?? 15;

    return this.prisma.$transaction(async (tx) => {
      const flip = await tx.evConnector.updateMany({
        where: { id: dto.connectorId, status: EvConnectorStatus.AVAILABLE },
        data: { status: EvConnectorStatus.RESERVED },
      });
      if (flip.count === 0) {
        throw new BadRequestException('Connector is not currently available for reservation');
      }

      return tx.evReservation.create({
        data: {
          connectorId: dto.connectorId,
          userId,
          startAt: new Date(dto.startAt),
          expiresAt: new Date(Date.now() + holdMinutes * 60_000),
          status: EvReservationStatus.CONFIRMED,
        },
      });
    });
  }

  async cancel(reservationId: string, userId: string) {
    const reservation = await this.prisma.evReservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.userId !== userId) {
      throw new NotFoundException('Reservation not found');
    }
    if (reservation.status !== EvReservationStatus.CONFIRMED && reservation.status !== EvReservationStatus.PENDING) {
      throw new BadRequestException(`Reservation cannot be cancelled (status: ${reservation.status})`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.evConnector.update({
        where: { id: reservation.connectorId },
        data: { status: EvConnectorStatus.AVAILABLE },
      });
      return tx.evReservation.update({
        where: { id: reservationId },
        data: { status: EvReservationStatus.CANCELLED },
      });
    });
  }

  listMine(userId: string) {
    return this.prisma.evReservation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { connector: { include: { station: true } } },
    });
  }

  /** Scheduled: frees connectors whose reservation hold lapsed unused. */
  async expireStaleReservations(now = new Date()) {
    const stale = await this.prisma.evReservation.findMany({
      where: { status: EvReservationStatus.CONFIRMED, expiresAt: { lte: now } },
    });

    for (const reservation of stale) {
      await this.prisma.$transaction(async (tx) => {
        await tx.evReservation.update({
          where: { id: reservation.id },
          data: { status: EvReservationStatus.EXPIRED },
        });
        await tx.evConnector.update({
          where: { id: reservation.connectorId },
          data: { status: EvConnectorStatus.AVAILABLE },
        });
      });
    }
    return stale.length;
  }
}
