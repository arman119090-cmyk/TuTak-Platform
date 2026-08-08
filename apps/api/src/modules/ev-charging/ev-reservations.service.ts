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
      // Free only a bay this reservation is still holding. The status was
      // read outside this transaction, so a session may have started on the
      // connector in between — and an unconditional release then hands a
      // charging cable to the next customer while it is delivering energy to
      // this one's car. Same failure as §F-1 in the financial audit, in a
      // path that fix did not cover.
      await tx.evConnector.updateMany({
        where: { id: reservation.connectorId, status: EvConnectorStatus.RESERVED },
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

    let expired = 0;
    for (const reservation of stale) {
      await this.prisma.$transaction(async (tx) => {
        // The list above was selected outside this transaction. A customer
        // who plugged in during that window has since fulfilled this hold —
        // which is exactly when they hurry, minutes before it lapses — and
        // marking it EXPIRED would say they never turned up for a session
        // they are charging on right now.
        const claimed = await tx.evReservation.updateMany({
          where: { id: reservation.id, status: EvReservationStatus.CONFIRMED },
          data: { status: EvReservationStatus.EXPIRED },
        });
        if (claimed.count === 0) return;

        // And only then the bay, and only if this hold still owns it.
        await tx.evConnector.updateMany({
          where: { id: reservation.connectorId, status: EvConnectorStatus.RESERVED },
          data: { status: EvConnectorStatus.AVAILABLE },
        });
        expired += 1;
      });
    }
    return expired;
  }
}
