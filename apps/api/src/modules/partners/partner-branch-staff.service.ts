import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BranchStaffRole, PartnerBranchState, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PartnerEmployeeService } from './partner-employee.service';

/**
 * Which branch(es) of a multi-branch partner a member of staff may actually
 * act at — see `PartnerBranchStaffAssignment`'s own schema docblock for the
 * gap this closes. This service only ever narrows reach that a `UserRole`
 * already granted; it never grants partner-scoped access on its own — that
 * stays `AdminService.assignRole`'s job.
 */
/**
 * Which unique index a `P2002` came from.
 *
 * Prisma reports the target either by index name or by the columns it
 * covers, depending on how it learned about it, and a partial index declared
 * in SQL rather than in the schema is usually the columns. Both spellings
 * are accepted; nothing else on this table is unique on these columns, so
 * neither form can mean anything else.
 */
function collidedOn(err: Prisma.PrismaClientKnownRequestError, column: string): boolean {
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.toLowerCase().includes(column.toLowerCase());
}

@Injectable()
export class PartnerBranchStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: PartnerEmployeeService,
  ) {}

  /** The branch, once it is established that it is this partner's. */
  private async assertBranchBelongsToPartner(partnerId: string, branchId: string) {
    const branch = await this.prisma.partnerBranch.findUnique({ where: { id: branchId } });
    if (!branch || branch.partnerId !== partnerId) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  listForBranch(partnerId: string, branchId: string, includeInactive = false) {
    return this.prisma.partnerBranchStaffAssignment.findMany({
      where: { partnerId, partnerBranchId: branchId, ...(includeInactive ? {} : { isActive: true }) },
      include: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * A partner's staff roster — the portal's "employees" page.
   *
   * `branchIds` is `branchFilterFor`'s answer for the caller: `null` for an
   * owner, admin or all-branch manager, who sees the whole network exactly
   * as before; otherwise the caller's own assignment list, and the roster is
   * narrowed to those branches in the query itself.
   *
   * Without that narrowing this endpoint was the one hole left in branch
   * scoping: `assertPartnerScope` passes for any of the partner's staff, so
   * a cashier assigned to branch A could read branch B's roster — names,
   * phone numbers and employee codes — from the sibling of an endpoint
   * (`listForBranch`) that refuses exactly that. An empty array is a real
   * answer, not a missing filter: staff with no active assignment see
   * nobody.
   */
  listForPartner(partnerId: string, includeInactive = false, branchIds: string[] | null = null) {
    return this.prisma.partnerBranchStaffAssignment.findMany({
      where: {
        partnerId,
        ...(branchIds === null ? {} : { partnerBranchId: { in: branchIds } }),
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * The assignment's own display code, taken from the partner's shared
   * counter rather than from a second reading of the highest number.
   *
   * Both codes live in one `EMP-` namespace per partner, so both have to be
   * issued by the same allocator — see `PartnerEmployeeService.nextCode` for
   * why reading a maximum and inserting past it is a race rather than a
   * scheme.
   */
  private nextDisplayCode(partnerId: string): Promise<string> {
    return this.employees.nextCode(partnerId);
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
    const branch = await this.assertBranchBelongsToPartner(partnerId, branchId);
    // Posting somebody to a location that is closed for good is a promise
    // nobody can keep: they could not take a purchase there, and the roster
    // would name a place the business no longer trades at. A *suspended*
    // branch is a different matter — it reopens, and the people who work
    // there are still the people who work there.
    if (branch.state === PartnerBranchState.ARCHIVED) {
      throw new BadRequestException('This branch is archived and cannot take new staff');
    }

    const hasPartnerRole = await this.prisma.userRole.findFirst({
      where: { userId: params.userId, partnerId },
    });
    if (!hasPartnerRole) {
      throw new BadRequestException('This user has no staff role at this partner yet');
    }

    // A hand-picked code has to move the counter, or the allocator walks up
    // to it later and collides with a code this partner is already using.
    if (params.employeeDisplayCode) {
      await this.employees.reserveUpTo(partnerId, params.employeeDisplayCode);
    }

    // The person's permanent code at this partner, minted now if this is the
    // first time they have been named. Separate from the assignment code
    // below and deliberately so: this one survives the transfer that ends
    // this assignment — see `PartnerEmployeeService`.
    await this.employees.codeFor(partnerId, params.userId);

    // A code the caller chose is theirs to fix if it is taken; a code this
    // method drew is this method's to draw again.
    //
    // The second case is not hypothetical during a rolling deploy: the
    // previous release issues assignment codes by reading the highest one
    // and adding one, which is exactly the number the counter is about to
    // hand out. One redraw walks past it. Bounded for the same reason
    // `codeFor` bounds its own loop.
    for (let attempt = 0; ; attempt += 1) {
      const employeeDisplayCode =
        params.employeeDisplayCode ?? (await this.nextDisplayCode(partnerId));
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
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
          throw err;
        }
        // Two distinct unique constraints reach here. The partial "one ACTIVE
        // assignment per (user, branch)" index means this person is already
        // posted here, and redrawing a code would not change that; the
        // "employeeDisplayCode unique per partner" one means the number is
        // taken. Only the second is worth another round, and only when the
        // number was ours to choose.
        const codeCollision = collidedOn(err, 'employeeDisplayCode');
        if (!codeCollision || params.employeeDisplayCode || attempt >= 3) {
          throw new ConflictException(
            'This user is already assigned here, or the employee code is already taken — please retry.',
          );
        }
      }
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
