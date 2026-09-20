import { Injectable } from '@nestjs/common';
import type { DriverIdChangeRequest } from '@prisma/client';
import { DriverIdChangeRequestDto, DriverIdStateDto } from '@cashout/contracts';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService, TransactionClient, isUniqueViolation } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { MembershipService } from '../parks/membership.service';
import { YandexFleetPort } from '../yandex/yandex.port';

/**
 * Changing the Driver ID — the contractor profile id the driver's membership
 * points at inside the park.
 *
 * The new id never becomes active on the driver's word. The server asks the
 * park's Fleet API for the profile: if it exists and carries the driver's own
 * phone number, the change is approved on the spot; if it exists under another
 * number, or cannot be found, or the fleet does not answer, the request waits
 * for an operator with the finding attached. Every request, decision and
 * application is kept and audited, because the consequence of a wrong Driver
 * ID is paying one person another person's balance.
 */
@Injectable()
export class DriverIdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
    private readonly yandex: YandexFleetPort,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly logger: AppLogger,
  ) {}

  async state(driverId: string): Promise<DriverIdStateDto> {
    const driver = await this.prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      include: { activeMembership: { include: { park: true } } },
    });
    const requests = await this.prisma.driverIdChangeRequest.findMany({
      where: { driverId },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
    const parks = await this.parkNames(requests.map((row) => row.parkId));
    const mapped = requests.map((row) => toDto(row, parks));
    return {
      current: driver.activeMembership
        ? {
            driverId: driver.activeMembership.externalProfileId,
            park: { id: driver.activeMembership.parkId, name: driver.activeMembership.park.name },
          }
        : null,
      pending: mapped.find((row) => row.status === 'PENDING') ?? null,
      history: mapped,
    };
  }

  async request(driverId: string, newDriverId: string): Promise<DriverIdChangeRequestDto> {
    const { driver, membership, park } = await this.memberships.requireActive(driverId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: driver.userId } });

    if (newDriverId === membership.externalProfileId) {
      throw new AppError('DRIVER_ID_INVALID', 'That is already your Driver ID');
    }
    const pending = await this.prisma.driverIdChangeRequest.findFirst({
      where: { driverId, status: 'PENDING' },
    });
    if (pending) {
      throw new AppError('DRIVER_ID_CHANGE_PENDING', 'A change is already being checked', {
        requestId: pending.id,
      });
    }
    const claimed = await this.prisma.driverParkMembership.findUnique({
      where: { parkId_externalProfileId: { parkId: park.id, externalProfileId: newDriverId } },
    });
    if (claimed && claimed.id !== membership.id) {
      throw new AppError('DRIVER_ID_INVALID', 'That Driver ID belongs to another driver');
    }

    // The automatic check against the park's Fleet API.
    let note: string;
    let approved = false;
    try {
      const profile = await this.yandex.getProfile(park.yandexParkId, newDriverId);
      if (!profile) {
        note = 'profile_not_found';
      } else if (profile.blocked) {
        note = 'profile_blocked';
      } else if (profile.phones.includes(user.phone)) {
        note = 'phone_matched';
        approved = true;
      } else {
        note = 'phone_mismatch';
      }
    } catch (error) {
      this.logger.fail('Driver ID verification: Fleet API unavailable', error, { driverId });
      note = 'yandex_unavailable';
    }

    const created = await this.prisma.driverIdChangeRequest.create({
      data: {
        membershipId: membership.id,
        driverId,
        parkId: park.id,
        previousExternalId: membership.externalProfileId,
        requestedExternalId: newDriverId,
        status: 'PENDING',
        source: 'DRIVER',
        requestedAt: this.clock.now(),
        verifiedAt: approved ? this.clock.now() : null,
        verificationNote: note,
      },
    });
    await this.audit.record({
      action: 'driver_id.requested',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
      actorId: driver.userId,
      after: { requestId: created.id, from: membership.externalProfileId, to: newDriverId, note },
    });

    if (approved) {
      const applied = await this.apply(
        created.id,
        null,
        'verified against the fleet: phone matched',
      );
      if (applied) return this.one(created.id);
    }
    return this.one(created.id);
  }

  async cancel(driverId: string, requestId: string): Promise<void> {
    const row = await this.prisma.driverIdChangeRequest.findFirst({
      where: { id: requestId, driverId },
    });
    if (!row) throw AppError.notFound('Request');
    if (row.status !== 'PENDING') {
      throw new AppError('VALIDATION_FAILED', 'Only a pending request can be cancelled');
    }
    await this.prisma.driverIdChangeRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        decidedAt: this.clock.now(),
        decisionReason: 'cancelled by driver',
      },
    });
    await this.audit.record({
      action: 'driver_id.cancelled',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
      after: { requestId },
    });
  }

  // ------------------------------------------------------------------ admin

  async listForAdmin(query: { status?: string; limit: number; cursor?: string }) {
    const rows = await this.prisma.driverIdChangeRequest.findMany({
      where: query.status ? { status: query.status as DriverIdChangeRequest['status'] } : {},
      orderBy: { requestedAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { membership: { include: { driver: { include: { user: true } } } } },
    });
    const parks = await this.parkNames(rows.map((row) => row.parkId));
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        ...toDto(row, parks),
        driverId: row.driverId,
        phone: row.membership.driver?.user.phone ?? row.membership.phone,
        driverName:
          [row.membership.firstName, row.membership.lastName].filter(Boolean).join(' ') || null,
      })),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async approve(requestId: string, adminId: string, reason: string): Promise<void> {
    const row = await this.requirePending(requestId);
    const applied = await this.apply(row.id, adminId, reason);
    if (!applied) {
      throw new AppError(
        'WITHDRAWAL_ALREADY_IN_PROGRESS',
        'A payout is in progress for this driver; approve once it has finished',
      );
    }
  }

  async reject(requestId: string, adminId: string, reason: string): Promise<void> {
    const row = await this.requirePending(requestId);
    await this.prisma.driverIdChangeRequest.update({
      where: { id: row.id },
      data: {
        status: 'REJECTED',
        decidedAt: this.clock.now(),
        decidedByAdminId: adminId,
        decisionReason: reason,
      },
    });
    await this.audit.record({
      action: 'driver_id.rejected',
      subjectType: 'driver',
      subjectId: row.driverId,
      actorType: 'ADMIN',
      actorId: adminId,
      reason,
      after: { requestId: row.id, requested: row.requestedExternalId },
    });
    await this.notifications.enqueue({
      driverId: row.driverId,
      kind: 'DRIVER_ID_DECIDED',
      payload: { requestId: row.id, status: 'REJECTED' },
    });
  }

  // ------------------------------------------------------------------ internals

  /**
   * Makes the requested id the membership's id. Refuses to do so while a
   * withdrawal is running against the old one, because the withdrawal row and
   * the membership must keep agreeing on who was debited.
   */
  private async apply(requestId: string, adminId: string | null, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.driverIdChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (row.status !== 'PENDING') return false;

      const live = await tx.withdrawal.count({
        where: {
          driverId: row.driverId,
          state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
        },
      });
      if (live > 0) {
        await tx.driverIdChangeRequest.update({
          where: { id: requestId },
          data: { verificationNote: `${row.verificationNote ?? ''};withdrawal_in_progress` },
        });
        return false;
      }

      try {
        await tx.driverParkMembership.update({
          where: { id: row.membershipId },
          data: { externalProfileId: row.requestedExternalId },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          await tx.driverIdChangeRequest.update({
            where: { id: requestId },
            data: {
              status: 'REJECTED',
              decidedAt: this.clock.now(),
              decidedByAdminId: adminId,
              decisionReason: 'that Driver ID belongs to another driver',
            },
          });
          return false;
        }
        throw error;
      }

      await tx.driverIdChangeRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          verifiedAt: row.verifiedAt ?? this.clock.now(),
          decidedAt: this.clock.now(),
          decidedByAdminId: adminId,
          decisionReason: reason,
        },
      });
      // The balance was for the old profile; nothing cached may survive.
      await tx.balanceSnapshot.deleteMany({ where: { driverId: row.driverId } });
      await this.audit.record(
        {
          action: 'driver_id.changed',
          subjectType: 'driver',
          subjectId: row.driverId,
          actorType: adminId ? 'ADMIN' : 'SYSTEM',
          actorId: adminId ?? undefined,
          reason,
          before: { driverId: row.previousExternalId },
          after: { driverId: row.requestedExternalId, requestId: row.id },
        },
        tx as TransactionClient,
      );
      await this.notifications.enqueue(
        {
          driverId: row.driverId,
          kind: 'DRIVER_ID_DECIDED',
          payload: { requestId: row.id, status: 'APPROVED' },
        },
        tx as TransactionClient,
      );
      return true;
    });
  }

  private async requirePending(requestId: string): Promise<DriverIdChangeRequest> {
    const row = await this.prisma.driverIdChangeRequest.findUnique({ where: { id: requestId } });
    if (!row) throw AppError.notFound('Request');
    if (row.status !== 'PENDING') {
      throw new AppError('VALIDATION_FAILED', `This request is already ${row.status}`);
    }
    return row;
  }

  private async one(requestId: string): Promise<DriverIdChangeRequestDto> {
    const row = await this.prisma.driverIdChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    return toDto(row, await this.parkNames([row.parkId]));
  }

  private async parkNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.park.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

function toDto(row: DriverIdChangeRequest, parks: Map<string, string>): DriverIdChangeRequestDto {
  return {
    id: row.id,
    park: { id: row.parkId, name: parks.get(row.parkId) ?? '—' },
    previousDriverId: row.previousExternalId,
    requestedDriverId: row.requestedExternalId,
    status: row.status,
    source: row.source === 'ADMIN' ? 'ADMIN' : 'DRIVER',
    requestedAt: row.requestedAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    verificationNote: row.verificationNote,
    decisionReason: row.decisionReason,
  };
}
