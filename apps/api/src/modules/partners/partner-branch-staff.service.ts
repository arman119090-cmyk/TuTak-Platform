import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BranchStaffRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Which branch(es) of a multi-branch partner a member of staff may actually
 * act at — see `PartnerBranchStaffAssignment`'s own schema docblock for the
 * gap this closes. This service only ever narrows reach that a `UserRole`
 * already granted; it never grants partner-scoped access on its own — that
 * stays `AdminService.assignRole`'s job.
 */
@Injectable()
export class PartnerBranchStaffService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBranchBelongsToPartner(partnerId: string, branchId: string) {
    const branch = await this.prisma.partnerBranch.findUnique({ where: { id: branchId } });
    if (!branch || branch.partnerId !== partnerId) {
      throw new NotFoundException('Branch not found');
    }
  }

  listForBranch(partnerId: string, branchId: string, includeInactive = false) {
    return this.prisma.partnerBranchStaffAssignment.findMany({
      where: { partnerId, partnerBranchId: branchId, ...(includeInactive ? {} : { isActive: true }) },
      include: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** A partner's full staff roster across every branch — the portal's "employees" page. */
  listForPartner(partnerId: string, includeInactive = false) {
    return this.prisma.partnerBranchStaffAssignment.findMany({
      where: { partnerId, ...(includeInactive ? {} : { isActive: true }) },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * `EMP-<n>` scoped to the partner, `n` one past the highest existing
   * numeric suffix. Best-effort: two concurrent assignments could still
   * collide on the partner-unique constraint, which the caller surfaces as
   * an ordinary 409 rather than this racing to retry — assigning staff is
   * low-frequency, manually-triggered work, not a hot path worth a retry
   * loop.
   */
  private async nextDisplayCode(partnerId: string): Promise<string> {
    const existing = await this.prisma.partnerBranchStaffAssignment.findMany({
      where: { partnerId, employeeDisplayCode: { startsWith: 'EMP-' } },
      select: { employeeDisplayCode: true },
    });
    const max = existing.reduce((highest, { employeeDisplayCode }) => {
      const n = Number(employeeDisplayCode.slice('EMP-'.length));
      return Number.isFinite(n) && n > highest ? n : highest;
    }, 0);
    return `EMP-${String(max + 1).padStart(3, '0')}`;
  }

  /**
   * Requires the target user to already hold a `PARTNER_STAFF`/
   * `PARTNER_MANAGER`/`PARTNER_OWNER` role scoped to this partner — this
   * service narrows an existing grant to a branch, it never manufactures
   * one for an unrelated user.
   */
  async assign(
    partnerId: string,
    branchId: string,
    params: { userId: string; role?: BranchStaffRole; employeeDisplayCode?: string; assignedByUserId: string },
  ) {
    await this.assertBranchBelongsToPartner(partnerId, branchId);

    const hasPartnerRole = await this.prisma.userRole.findFirst({
      where: { userId: params.userId, partnerId },
    });
    if (!hasPartnerRole) {
      throw new BadRequestException('This user has no staff role at this partner yet');
    }

    const employeeDisplayCode = params.employeeDisplayCode ?? (await this.nextDisplayCode(partnerId));

    try {
      return await this.prisma.partnerBranchStaffAssignment.create({
        data: {
          partnerId,
          partnerBranchId: branchId,
          userId: params.userId,
          role: params.role ?? BranchStaffRole.STAFF,
          employeeDisplayCode,
          assignedByUserId: params.assignedByUserId,
        },
      });
    } catch (err) {
      // Two distinct unique constraints can fire here: the partial "one
      // ACTIVE assignment per (user, branch)" index (this user is already
      // assigned here) and the ordinary "employeeDisplayCode unique per
      // partner" one (a caller-supplied code collided, or a concurrent
      // auto-generated one raced this request). Both are the caller's to
      // retry with different input, never a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'This user is already assigned here, or the employee code is already taken — please retry.',
        );
      }
      throw err;
    }
  }

  /**
   * The row itself is never deleted — see the model's own docblock on why:
   * every confirm/reject/refund this person made while active must keep
   * resolving to who they were and which branch they were assigned to.
   */
  async deactivate(partnerId: string, assignmentId: string, deactivatedByUserId: string) {
    const { count } = await this.prisma.partnerBranchStaffAssignment.updateMany({
      where: { id: assignmentId, partnerId, isActive: true },
      data: { isActive: false, deactivatedAt: new Date(), deactivatedByUserId },
    });
    if (count === 0) throw new NotFoundException('Active assignment not found');
    return this.prisma.partnerBranchStaffAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
  }

  /**
   * Grants or revokes the `UserRole.allBranches` exception for every
   * partner-scoped role this user holds at this partner (in practice
   * exactly one — `UserRole` is unique on `[userId, roleId, partnerId]`,
   * and a user is realistically staff/manager, not both, at one partner).
   */
  async setAllBranches(partnerId: string, userId: string, allBranches: boolean) {
    const { count } = await this.prisma.userRole.updateMany({
      where: { userId, partnerId },
      data: { allBranches },
    });
    if (count === 0) throw new NotFoundException('This user has no staff role at this partner');
  }
}
