import { Injectable } from '@nestjs/common';
import type { Driver, DriverParkMembership, Park } from '@prisma/client';
import { DriverProfileDto, MembershipDto, ParkSummaryDto } from '@cashout/contracts';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';

export type MembershipWithPark = DriverParkMembership & { park: Park };

export interface ActiveContext {
  readonly driver: Driver;
  readonly membership: MembershipWithPark;
  readonly park: Park;
}

/**
 * Who the driver is inside which park.
 *
 * The roster — `DriverParkMembership` rows — is Cash Out's own database of
 * drivers. After the OTP the phone number is looked up here, never entered by
 * the driver as a park id: a driver who is in no roster is told so, a driver in
 * one park is placed in it, a driver in several chooses.
 *
 * The active membership is the only thing money code reads. Every balance,
 * quote and withdrawal is scoped to it, and switching it throws away every
 * cached balance of the park being left, so a figure from the old park can
 * never be shown — let alone paid — under the new one.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Attaches roster rows that carry the driver's phone, then decides where the
   * driver stands: no park, one park (chosen automatically), or a choice.
   */
  async resolve(userId: string): Promise<DriverProfileDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { driver: true },
    });
    const driver = user.driver;
    if (!driver) throw AppError.notFound('Driver');

    await this.attachByPhone(driver.id, user.phone);

    let memberships = await this.membershipsOf(driver.id);
    const available = memberships.filter(isAvailable);

    let active = memberships.find((row) => row.id === driver.activeMembershipId) ?? null;
    if (active && !isAvailable(active)) {
      // The park closed or the roster changed underneath the driver. Nothing
      // money-related may keep running against it.
      await this.deactivate(driver.id, active, 'membership no longer available');
      active = null;
    }

    if (!active && available.length === 1 && driver.verificationStatus !== 'BLOCKED') {
      await this.activateMembership(driver.id, available[0]!, 'AUTO', null);
      memberships = await this.membershipsOf(driver.id);
      active = memberships.find((row) => row.id === available[0]!.id) ?? null;
    }

    const fresh = await this.prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });

    return {
      id: fresh.id,
      phone: user.phone,
      firstName: fresh.firstName ?? active?.firstName ?? null,
      lastName: fresh.lastName ?? active?.lastName ?? null,
      locale: user.locale as DriverProfileDto['locale'],
      verificationStatus: fresh.verificationStatus,
      resolution: active ? 'ACTIVE' : available.length > 1 ? 'CHOOSE' : 'NONE',
      activePark: active ? toParkSummary(active.park) : null,
      driverId: active?.externalProfileId ?? null,
      membershipCount: memberships.length,
      currency: active?.park.currency ?? fresh.currency ?? null,
    };
  }

  async list(driverId: string): Promise<MembershipDto[]> {
    const driver = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    const memberships = await this.membershipsOf(driverId);
    return memberships.map((row) => toMembershipDto(row, row.id === driver.activeMembershipId));
  }

  /**
   * The driver picks a park. The server decides whether they may: the
   * membership must be theirs, active, eligible, and in a park that is open.
   * A denial changes nothing.
   */
  async activate(
    driverId: string,
    parkId: string,
    actorType: 'DRIVER' | 'ADMIN',
    actorId: string | null,
  ) {
    const driver = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    if (driver.verificationStatus === 'BLOCKED') {
      throw new AppError('DRIVER_BLOCKED', driver.blockReason ?? 'Withdrawals are blocked');
    }

    const membership = await this.prisma.driverParkMembership.findFirst({
      where: { driverId, parkId },
      include: { park: true },
    });
    if (!membership) {
      throw new AppError('PARK_ACCESS_DENIED', 'This driver is not in that park', {
        reason: 'not_a_member',
      });
    }
    if (!isAvailable(membership)) {
      throw new AppError('PARK_ACCESS_DENIED', 'This membership cannot be used right now', {
        reason: denialReason(membership),
      });
    }
    if (membership.id === driver.activeMembershipId) return;

    const live = await this.prisma.withdrawal.count({
      where: { driverId, state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] } },
    });
    if (live > 0) {
      throw new AppError(
        'WITHDRAWAL_ALREADY_IN_PROGRESS',
        'Finish the payout in progress before changing park',
      );
    }

    await this.activateMembership(driverId, membership, actorType, actorId);
  }

  /**
   * The active park, or a precise reason there is none. Money code calls this
   * and nothing else to learn where a driver's balance lives.
   */
  async requireActive(driverId: string, tx?: TransactionClient): Promise<ActiveContext> {
    const client = tx ?? this.prisma;
    const driver = await client.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw AppError.notFound('Driver');
    if (driver.verificationStatus === 'BLOCKED') {
      throw new AppError('DRIVER_BLOCKED', driver.blockReason ?? 'Withdrawals are blocked');
    }
    if (!driver.activeMembershipId) {
      throw new AppError('PARK_NOT_SELECTED', 'No taxi park is selected');
    }
    const membership = await client.driverParkMembership.findUnique({
      where: { id: driver.activeMembershipId },
      include: { park: true },
    });
    if (!membership || membership.driverId !== driverId) {
      throw new AppError('PARK_NOT_SELECTED', 'The active membership is gone');
    }
    if (!isAvailable(membership)) {
      throw new AppError('PARK_ACCESS_DENIED', 'The active park is not available', {
        reason: denialReason(membership),
      });
    }
    if (driver.verificationStatus !== 'VERIFIED') {
      throw new AppError('DRIVER_NOT_VERIFIED', 'This driver is not verified');
    }
    return { driver, membership, park: membership.park };
  }

  // ------------------------------------------------------------------ internals

  private async attachByPhone(driverId: string, phone: string): Promise<void> {
    const attached = await this.prisma.driverParkMembership.updateMany({
      where: { phone, driverId: null, status: { not: 'REMOVED' } },
      data: { driverId },
    });
    if (attached.count > 0) {
      this.logger.info('Roster rows attached to driver', { driverId, count: attached.count });
    }
  }

  private membershipsOf(driverId: string): Promise<MembershipWithPark[]> {
    return this.prisma.driverParkMembership.findMany({
      where: { driverId, status: { not: 'REMOVED' } },
      include: { park: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async activateMembership(
    driverId: string,
    membership: MembershipWithPark,
    actorType: 'AUTO' | 'DRIVER' | 'ADMIN',
    actorId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.driver.findUniqueOrThrow({
        where: { id: driverId },
        include: { activeMembership: true },
      });
      await tx.driver.update({
        where: { id: driverId },
        data: {
          activeMembershipId: membership.id,
          verificationStatus: 'VERIFIED',
          verifiedAt: before.verifiedAt ?? this.clock.now(),
          firstName: membership.firstName ?? before.firstName,
          lastName: membership.lastName ?? before.lastName,
          currency: membership.park.currency,
        },
      });
      // The previous park's figures are gone, not stale: nothing from it may
      // be shown until a fresh balance for the new park has been read.
      await tx.balanceSnapshot.deleteMany({ where: { driverId } });
      await tx.parkSwitch.create({
        data: {
          driverId,
          fromParkId: before.activeMembership?.parkId ?? null,
          toParkId: membership.parkId,
          actorType,
          actorId,
        },
      });
      await this.audit.record(
        {
          action: actorType === 'AUTO' ? 'driver.park_selected' : 'driver.park_switched',
          subjectType: 'driver',
          subjectId: driverId,
          actorType: actorType === 'AUTO' ? 'SYSTEM' : actorType,
          actorId: actorId ?? undefined,
          before: { parkId: before.activeMembership?.parkId ?? null },
          after: { parkId: membership.parkId, externalProfileId: membership.externalProfileId },
        },
        tx,
      );
      if (actorType !== 'AUTO') {
        await this.notifications.enqueue(
          {
            driverId,
            kind: 'PARK_SWITCHED',
            payload: { parkId: membership.parkId, parkName: membership.park.name },
          },
          tx,
        );
      }
    });
  }

  private async deactivate(
    driverId: string,
    membership: MembershipWithPark,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id: driverId },
        data: {
          activeMembershipId: null,
          verificationStatus: membership.eligibility === 'PENDING_REVIEW' ? 'PENDING' : 'UNLINKED',
        },
      });
      await tx.balanceSnapshot.deleteMany({ where: { driverId } });
      await this.audit.record(
        {
          action: 'driver.park_deactivated',
          subjectType: 'driver',
          subjectId: driverId,
          actorType: 'SYSTEM',
          reason,
          before: { parkId: membership.parkId },
        },
        tx,
      );
      await this.notifications.enqueue(
        { driverId, kind: 'PARK_ACCESS_CHANGED', payload: { parkId: membership.parkId, reason } },
        tx,
      );
    });
  }
}

export function isAvailable(membership: MembershipWithPark): boolean {
  return (
    membership.status === 'ACTIVE' &&
    membership.eligibility === 'ELIGIBLE' &&
    membership.park.status === 'ACTIVE'
  );
}

function denialReason(membership: MembershipWithPark): string {
  if (membership.park.status !== 'ACTIVE') return 'park_suspended';
  if (membership.status !== 'ACTIVE') return `membership_${membership.status.toLowerCase()}`;
  return `eligibility_${membership.eligibility.toLowerCase()}`;
}

export function toParkSummary(park: Park): ParkSummaryDto {
  return {
    id: park.id,
    code: park.code,
    name: park.name,
    status: park.status,
    currency: park.currency,
  };
}

export function toMembershipDto(row: MembershipWithPark, isActive: boolean): MembershipDto {
  return {
    id: row.id,
    park: toParkSummary(row.park),
    externalProfileId: row.externalProfileId,
    status: row.status,
    eligibility: row.eligibility,
    available: isAvailable(row),
    isActive,
  };
}
