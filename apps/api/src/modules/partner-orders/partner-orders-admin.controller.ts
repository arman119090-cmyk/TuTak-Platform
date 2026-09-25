import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrderEscalationType, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { SourcingTaskService } from './sourcing-task.service';
import { OrderEscalationService } from './order-escalation.service';
import { CommissionRuleService } from './commission-rule.service';
import { RecordSourcingResultDto } from './dto/record-sourcing-result.dto';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';

/**
 * TuTak staff/admin side of Partner Commerce — spec §13, §21. Mirrors
 * `SecurityController`'s shape (`admin/fraud-signals`) exactly: a
 * `listOpen`-style queue behind `ADMIN_AUDIT_READ`, one action per row.
 */
@ApiTags('admin/partner-orders')
@ApiBearerAuth()
@Controller('admin/partner-orders')
export class PartnerOrdersAdminController {
  constructor(
    private readonly sourcingTasks: SourcingTaskService,
    private readonly escalations: OrderEscalationService,
    private readonly commissionRules: CommissionRuleService,
  ) {}

  // ── Sourcing queue — spec §13 ────────────────────────────────────────────

  @Get('sourcing-tasks')
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  listSourcingTasks() {
    return this.sourcingTasks.listOpen();
  }

  @Post('sourcing-tasks/:id/claim')
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  claimSourcingTask(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    return this.sourcingTasks.claim(id, staff.id);
  }

  @Post('sourcing-tasks/:id/result')
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  recordSourcingResult(
    @CurrentUser() staff: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: RecordSourcingResultDto,
  ) {
    return this.sourcingTasks.recordResult(id, dto, staff.id);
  }

  // ── Escalation queue — spec §8-9, §21 ───────────────────────────────────

  @Get('escalations')
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  listEscalations(@Query('type') type?: OrderEscalationType) {
    return this.escalations.listOpen(type);
  }

  @Post('escalations/:id/claim')
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  claimEscalation(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    return this.escalations.claim(id, staff.id);
  }

  @Post('escalations/:id/resolve')
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  resolveEscalation(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    return this.escalations.resolve(id, staff.id);
  }

  // ── Commission rules — spec §19 ─────────────────────────────────────────

  @Get('commission-rules')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  listCommissionRules(@Query('partnerId') partnerId?: string) {
    return this.commissionRules.list(partnerId);
  }

  @Post('commission-rules')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  createCommissionRule(@CurrentUser() admin: RequestUser, @Body() dto: CreateCommissionRuleDto) {
    return this.commissionRules.create({ ...dto, partnerId: dto.partnerId ?? null, actorUserId: admin.id });
  }

  @Post('commission-rules/:id/deactivate')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  deactivateCommissionRule(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string) {
    return this.commissionRules.deactivate(id, admin.id);
  }
}
