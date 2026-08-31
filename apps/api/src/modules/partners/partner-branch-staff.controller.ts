import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerOwner, assertPartnerScope } from '../../common/auth/partner-scope';
import { assertBranchScope, branchFilterFor } from '../../common/auth/branch-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { AssignBranchStaffDto } from './dto/assign-branch-staff.dto';
import { SetAllBranchesDto } from './dto/set-all-branches.dto';
import { PartnerBranchStaffService } from './partner-branch-staff.service';

/**
 * Fuel-station branches task: which branch(es) a partner's staff may
 * actually act at. See `PartnerBranchStaffAssignment`'s schema docblock for
 * the gap this closes, and `common/auth/branch-scope.ts` for how every
 * other endpoint in the system consumes it.
 */
@ApiTags('partner-branch-staff')
@ApiBearerAuth()
@Controller('partners/:id/branches/:branchId/staff')
export class PartnerBranchStaffController {
  constructor(
    private readonly staffService: PartnerBranchStaffService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Anyone actually scoped to this branch may see its own roster — same
   * reasoning `listBranches` uses for reading a partner's branch list.
   */
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('branchId') branchId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    assertBranchScope(user, partnerId, branchId);
    return this.staffService.listForBranch(partnerId, branchId, includeInactive === 'true');
  }

  /** Assigning staff to a branch is a trust decision — owner/admin only, same tier as creating the branch itself. */
  @Post()
  async assign(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @UuidParam('branchId') branchId: string,
    @Body() dto: AssignBranchStaffDto,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'assign staff to a branch');
    const assignment = await this.staffService.assign(partnerId, branchId, {
      userId: dto.userId,
      role: dto.role,
      employeeDisplayCode: dto.employeeDisplayCode,
      assignedByUserId: user.id,
    });
    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.BRANCH_STAFF_ASSIGNED,
      entityType: 'PartnerBranchStaffAssignment',
      entityId: assignment.id,
      metadata: { partnerId, branchId, userId: dto.userId, role: assignment.role },
    });
    return assignment;
  }

  @Patch(':assignmentId/deactivate')
  async deactivate(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @Param('branchId') _branchId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'take staff off a branch');
    const assignment = await this.staffService.deactivate(partnerId, assignmentId, user.id);
    await this.auditService.record({
      actorUserId: user.id,
      action: AuditAction.BRANCH_STAFF_DEACTIVATED,
      entityType: 'PartnerBranchStaffAssignment',
      entityId: assignment.id,
      metadata: { partnerId },
    });
    return assignment;
  }
}

/** Sibling controller: the partner-wide roster and the `allBranches` exception — neither is scoped to one branch. */
@ApiTags('partner-branch-staff')
@ApiBearerAuth()
@Controller('partners/:id/staff')
export class PartnerStaffController {
  constructor(
    private readonly staffService: PartnerBranchStaffService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    assertPartnerScope(user, partnerId);
    return this.staffService.listForPartner(
      partnerId,
      includeInactive === 'true',
      branchFilterFor(user, partnerId),
    );
  }

  /** Owner/admin granting or revoking a trusted manager's all-branch reach. */
  @Patch('all-branches')
  async setAllBranches(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @Body() dto: SetAllBranchesDto,
  ) {
    assertPartnerScope(user, partnerId);
    assertPartnerOwner(user, partnerId, 'grant all-branch access');
    await this.staffService.setAllBranches(partnerId, dto.userId, dto.allBranches);
    await this.auditService.record({
      actorUserId: user.id,
      action: dto.allBranches ? AuditAction.BRANCH_STAFF_ASSIGNED : AuditAction.BRANCH_STAFF_DEACTIVATED,
      entityType: 'UserRole',
      entityId: dto.userId,
      metadata: { partnerId, allBranches: dto.allBranches },
    });
    return { userId: dto.userId, allBranches: dto.allBranches };
  }
}
