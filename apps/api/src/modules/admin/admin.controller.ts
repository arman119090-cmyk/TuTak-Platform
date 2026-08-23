import { Body, Controller, Delete, ForbiddenException, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { SetActiveDto } from './dto/set-active.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@RequirePermissions(PermissionName.USER_MANAGE)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditService: AuditService,
  ) {}

  @Get('users')
  listUsers(@Query() query: CursorPaginationQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Post('users/roles')
  async assignRole(@CurrentUser() admin: RequestUser, @Body() dto: AssignRoleDto) {
    const result = await this.adminService.assignRole(dto, admin);
    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.ADMIN_ROLE_CHANGED,
      entityType: 'User',
      entityId: dto.userId,
      metadata: { role: dto.role, partnerId: dto.partnerId, op: 'grant' },
    });
    return result;
  }

  /**
   * `AdminService.revokeRole` has always existed — self-revocation blocked,
   * rank-checked, last-`SUPER_ADMIN` protected — but nothing ever called it
   * through the API. A partner-scoped role, once granted, could never be
   * removed through the product: offboarding a terminated or compromised
   * partner employee (who keeps whatever that role grants — QR issuance,
   * purchase confirmation, possibly EV station management — indefinitely)
   * required a direct database edit. `PATCH users/:id/active` only disables
   * the whole account globally, which is not the same control (independent
   * audit, GitHub issue #28).
   */
  @Delete('users/roles')
  async revokeRole(@CurrentUser() admin: RequestUser, @Body() dto: AssignRoleDto) {
    const result = await this.adminService.revokeRole(dto.userId, dto.role, dto.partnerId, admin);
    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.ADMIN_ROLE_CHANGED,
      entityType: 'User',
      entityId: dto.userId,
      metadata: { role: dto.role, partnerId: dto.partnerId, op: 'revoke' },
    });
    return result;
  }

  /**
   * `@Body('isActive')` extracted a raw value that ValidationPipe skips for
   * primitive metatypes, so `"false"` reached Prisma as a string and `{}` as
   * undefined — no schema at all on a security-relevant toggle (§M3).
   */
  @Patch('users/:id/active')
  async setActive(
    @CurrentUser() admin: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: SetActiveDto,
  ) {
    const isActive = dto.isActive;
    if (id === admin.id && !isActive) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    const user = await this.adminService.setActive(id, isActive);
    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.ACCOUNT_LOCKED,
      entityType: 'User',
      entityId: id,
      metadata: { isActive },
    });
    return user;
  }

  @Get('overview')
  overview() {
    return this.adminService.systemOverview();
  }
}
