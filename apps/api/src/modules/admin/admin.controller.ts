import { Body, Controller, Get, Patch, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';
import { AssignRoleDto } from './dto/assign-role.dto';

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
    const result = await this.adminService.assignRole(dto);
    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.ADMIN_ROLE_CHANGED,
      entityType: 'User',
      entityId: dto.userId,
      metadata: { role: dto.role, partnerId: dto.partnerId, op: 'grant' },
    });
    return result;
  }

  @Patch('users/:id/active')
  async setActive(
    @CurrentUser() admin: RequestUser,
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
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
