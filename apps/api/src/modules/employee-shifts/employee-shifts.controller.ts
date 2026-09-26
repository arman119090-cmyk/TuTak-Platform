import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertBranchScope } from '../../common/auth/branch-scope';
import { assertPartnerScope, assertPlatformAdmin } from '../../common/auth/partner-scope';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequestUser } from '../auth/types/request-user.type';
import { EmployeeShiftService } from './employee-shift.service';
import { StartShiftDto } from './dto/start-shift.dto';
import { RequireShiftsFromDto } from './dto/require-shifts-from.dto';

/**
 * "Начать смену / Завершить смену" (spec §6, §75). Any partner staff tier —
 * the same population that confirms purchases — at a branch it is scoped
 * to.
 */
@ApiTags('shifts')
@ApiBearerAuth()
@Controller('shifts')
export class EmployeeShiftsController {
  constructor(
    private readonly shifts: EmployeeShiftService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('start')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async start(@CurrentUser() user: RequestUser, @Body() dto: StartShiftDto) {
    const branch = await this.prisma.partnerBranch.findUnique({ where: { id: dto.branchId } });
    if (branch) assertBranchScope(user, branch.partnerId, branch.id);
    return this.shifts.start(user.id, dto.branchId);
  }

  @Post('end')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  end(@CurrentUser() user: RequestUser) {
    return this.shifts.end(user.id);
  }

  /**
   * The cashier's own state: the open shift (if any) and, for the partner
   * they work for, when shifts become mandatory — what the "Начните смену"
   * banner is driven by.
   */
  @Get('me')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async me(@CurrentUser() user: RequestUser, @Query('partnerId') partnerId?: string) {
    const shift = await this.shifts.current(user.id);
    const scopedPartnerId = partnerId ?? shift?.partnerId;
    if (scopedPartnerId) assertPartnerScope(user, scopedPartnerId);
    const requiredFrom = scopedPartnerId ? await this.shifts.shiftsRequiredFrom(scopedPartnerId) : null;
    return {
      shift,
      shiftsRequiredFrom: requiredFrom,
      shiftsRequiredNow: requiredFrom ? requiredFrom <= new Date() : null,
    };
  }

  @Get('branch/:branchId')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async listAtBranch(@CurrentUser() user: RequestUser, @UuidParam('branchId') branchId: string) {
    const branch = await this.prisma.partnerBranch.findUnique({ where: { id: branchId } });
    if (branch) assertBranchScope(user, branch.partnerId, branch.id);
    return this.shifts.listOpenAtBranch(branchId);
  }

  /** Platform admin only; can only move the date earlier. */
  @Post('admin/partners/:partnerId/required-from')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  requireFrom(
    @CurrentUser() admin: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @Body() dto: RequireShiftsFromDto,
  ) {
    assertPlatformAdmin(admin, 'Changing when shifts become mandatory');
    return this.shifts.requireShiftsFrom(partnerId, new Date(dto.at), admin.id);
  }
}
