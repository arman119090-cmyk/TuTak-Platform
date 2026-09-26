import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, ShiftEndReason } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { businessDateFor, fromDbDate, toDbDate } from './business-day';

type Tx = Prisma.TransactionClient;

/** What a financially binding action records about the shift it ran under (spec §6.2). */
export interface ShiftStamp {
  shiftId: string | null;
  branchId: string | null;
  /** True only inside a partner's one-off rollout window (`Partner.shiftsRequiredFrom`). */
  withoutShift: boolean;
}

export class ShiftRequiredError extends ForbiddenException {
  constructor() {
    super({ message: 'Start your shift first', code: 'SHIFT_REQUIRED' });
  }
}

/**
 * Employee shifts (spec §6, Q4). The model is "branch + business day +
 * employee", never "one active shift per branch":
 *
 *  - several employees can be on shift at one branch at the same time;
 *  - an employee has at most one open shift (partial unique index);
 *  - starting a shift closes every still-open shift at the same branch from
 *    a *previous* business day (yesterday's A/B/C forgot to close; today's
 *    D starts) — never another employee's shift from today;
 *  - an hourly sweep closes any shift whose business day has ended, so a
 *    branch nobody visits the next day is cleaned up too;
 *  - deactivating an employee's branch assignment closes their shift there.
 *
 * `stampFor` is the check every financially binding partner action calls
 * inside its own transaction. It *locks* the shift row with a conditional
 * UPDATE, so "shift close × confirmation" and "deactivation × confirmation"
 * serialise: whichever commits first wins, and a confirmation can never
 * commit against a shift that was already closed.
 */
@Injectable()
export class EmployeeShiftService {
  private readonly logger = new Logger(EmployeeShiftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async start(userId: string, branchId: string) {
    const branch = await this.prisma.partnerBranch.findUnique({ where: { id: branchId } });
    if (!branch) throw new NotFoundException('Branch not found');
    if (!branch.isActive) throw new BadRequestException('This branch is not currently open');

    const now = new Date();
    const businessDate = businessDateFor(now, branch.timezone, branch.businessDayStartMinute);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Yesterday's (or older) forgotten shifts at this branch — Q4's A/B/C.
        const staleClosed = await tx.employeeShift.updateMany({
          where: { branchId, endedAt: null, businessDate: { lt: toDbDate(businessDate) } },
          data: { endedAt: now, endReason: ShiftEndReason.NEW_BUSINESS_DAY },
        });

        const open = await tx.employeeShift.findFirst({ where: { userId, endedAt: null } });
        if (open) {
          // A double-tap, or the same person reopening the app: idempotent.
          if (open.branchId === branchId && fromDbDate(open.businessDate) === businessDate) return open;
          // Moving to another branch (or a leftover from an earlier day):
          // close it — one open shift per employee.
          await tx.employeeShift.update({
            where: { id: open.id },
            data: {
              endedAt: now,
              endReason: open.branchId === branchId ? ShiftEndReason.NEW_BUSINESS_DAY : ShiftEndReason.MANUAL,
              endedByUserId: userId,
            },
          });
        }

        const shift = await tx.employeeShift.create({
          data: { partnerId: branch.partnerId, branchId, userId, businessDate: toDbDate(businessDate), startedAt: now },
        });
        await this.auditService.record(
          {
            actorUserId: userId,
            action: AuditAction.EMPLOYEE_SHIFT_STARTED,
            entityType: 'EmployeeShift',
            entityId: shift.id,
            metadata: { partnerId: branch.partnerId, branchId, businessDate, previousDayShiftsClosed: staleClosed.count },
          },
          tx,
        );
        return shift;
      });
    } catch (err) {
      // Two concurrent starts by the same person: the partial unique index
      // lets exactly one through; the other returns that one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const open = await this.prisma.employeeShift.findFirst({ where: { userId, endedAt: null } });
        if (open) return open;
      }
      throw err;
    }
  }

  /** "Завершить смену" — idempotent: ending when nothing is open is a no-op. */
  async end(userId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.employeeShift.findFirst({ where: { userId, endedAt: null } });
      if (!open) return null;
      const ended = await tx.employeeShift.updateMany({
        where: { id: open.id, endedAt: null },
        data: { endedAt: now, endReason: ShiftEndReason.MANUAL, endedByUserId: userId },
      });
      if (ended.count > 0) {
        await this.auditService.record(
          {
            actorUserId: userId,
            action: AuditAction.EMPLOYEE_SHIFT_ENDED,
            entityType: 'EmployeeShift',
            entityId: open.id,
            metadata: { reason: ShiftEndReason.MANUAL, branchId: open.branchId },
          },
          tx,
        );
      }
      return tx.employeeShift.findUniqueOrThrow({ where: { id: open.id } });
    });
  }

  /**
   * The caller's open shift, if it is still for the branch's *current*
   * business day. A leftover from an earlier day is not an active shift —
   * it is closed here rather than reported as one.
   */
  async current(userId: string) {
    const open = await this.prisma.employeeShift.findFirst({
      where: { userId, endedAt: null },
      include: { branch: true },
    });
    if (!open) return null;
    const today = businessDateFor(new Date(), open.branch.timezone, open.branch.businessDayStartMinute);
    if (fromDbDate(open.businessDate) < today) {
      await this.prisma.employeeShift.updateMany({
        where: { id: open.id, endedAt: null },
        data: { endedAt: new Date(), endReason: ShiftEndReason.NEW_BUSINESS_DAY },
      });
      return null;
    }
    return open;
  }

  /** Everyone currently on shift at a branch — several at once is normal. */
  listOpenAtBranch(branchId: string) {
    return this.prisma.employeeShift.findMany({
      where: { branchId, endedAt: null },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { startedAt: 'asc' },
    });
  }

  /**
   * Hourly sweep: closes every open shift whose branch business day has
   * ended — the backstop for a branch where nobody starts a new shift the
   * next day. Idempotent (conditional on `endedAt: null`).
   */
  async closeStaleShifts(now = new Date()): Promise<number> {
    const open = await this.prisma.employeeShift.findMany({
      where: { endedAt: null },
      include: { branch: { select: { timezone: true, businessDayStartMinute: true } } },
    });
    let closed = 0;
    for (const shift of open) {
      const today = businessDateFor(now, shift.branch.timezone, shift.branch.businessDayStartMinute);
      if (fromDbDate(shift.businessDate) >= today) continue;
      const result = await this.prisma.employeeShift.updateMany({
        where: { id: shift.id, endedAt: null },
        data: { endedAt: now, endReason: ShiftEndReason.NEW_BUSINESS_DAY },
      });
      closed += result.count;
    }
    return closed;
  }

  /**
   * The shift check for a financially binding partner action — spec §6,
   * §26, §61 ("employee deactivation × confirmation", "shift close ×
   * employee confirmation"). Runs inside the action's own transaction:
   *
   *  - finds the employee's open shift for this partner (and, when the
   *    resource belongs to a branch, at that branch), for the branch's
   *    current business day;
   *  - locks it with a conditional UPDATE (`endedAt IS NULL`) — a close or a
   *    deactivation that commits first makes this return no row; one that
   *    starts after waits for this transaction;
   *  - if there is none: inside the partner's one-off rollout window the
   *    action proceeds and is stamped `withoutShift` (audited as such);
   *    afterwards it is refused.
   */
  async stampFor(
    tx: Tx,
    params: { userId: string; partnerId: string; branchId?: string | null; now?: Date },
  ): Promise<ShiftStamp> {
    const now = params.now ?? new Date();
    const open = await tx.employeeShift.findFirst({
      where: {
        userId: params.userId,
        partnerId: params.partnerId,
        endedAt: null,
        ...(params.branchId ? { branchId: params.branchId } : {}),
      },
      include: { branch: { select: { timezone: true, businessDayStartMinute: true } } },
    });

    if (open) {
      const today = businessDateFor(now, open.branch.timezone, open.branch.businessDayStartMinute);
      if (fromDbDate(open.businessDate) >= today) {
        const locked = await tx.employeeShift.updateMany({
          where: { id: open.id, endedAt: null },
          data: { endedAt: null },
        });
        if (locked.count === 1) return { shiftId: open.id, branchId: open.branchId, withoutShift: false };
      }
    }

    const partner = await tx.partner.findUniqueOrThrow({
      where: { id: params.partnerId },
      select: { shiftsRequiredFrom: true },
    });
    if (partner.shiftsRequiredFrom > now) {
      return { shiftId: null, branchId: params.branchId ?? null, withoutShift: true };
    }
    throw new ShiftRequiredError();
  }

  /**
   * Admin-only: bring a partner's mandatory-shift date forward. Deliberately
   * cannot move it later — the rollout window is a one-off transition, not a
   * switch to turn shifts off (Q4: "не оставлять feature flag как способ
   * бесконечно обходить смены").
   */
  async requireShiftsFrom(partnerId: string, at: Date, actorUserId: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundException('Partner not found');
    if (at > partner.shiftsRequiredFrom) {
      throw new BadRequestException('The mandatory-shift date can only be moved earlier');
    }
    const updated = await this.prisma.partner.update({ where: { id: partnerId }, data: { shiftsRequiredFrom: at } });
    await this.auditService.record({
      actorUserId,
      action: AuditAction.PARTNER_SHIFTS_REQUIRED_FROM_CHANGED,
      entityType: 'Partner',
      entityId: partnerId,
      metadata: { from: partner.shiftsRequiredFrom.toISOString(), to: at.toISOString() },
    });
    return { partnerId, shiftsRequiredFrom: updated.shiftsRequiredFrom };
  }

  async shiftsRequiredFrom(partnerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { shiftsRequiredFrom: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner.shiftsRequiredFrom;
  }
}
