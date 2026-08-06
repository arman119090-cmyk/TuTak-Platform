import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { hasPartnerScope } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { SetActiveDto } from '../admin/dto/set-active.dto';
import { PartnersService } from './partners.service';

@ApiTags('partners')
@ApiBearerAuth()
@Controller('partners')
export class PartnersController {
  constructor(
    private readonly partnersService: PartnersService,
    private readonly auditService: AuditService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Get()
  list() {
    return this.partnersService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.partnersService.findByIdOrThrow(id);
  }

  @Get(':id/transactions')
  async transactions(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query() query: CursorPaginationQueryDto,
  ) {
    if (!hasPartnerScope(user, id) && !(await this.partnersService.isMember(id, user.id))) {
      throw new ForbiddenException('You are not a member of this partner');
    }
    return this.transactionsService.history({ ...query, partnerId: id });
  }

  @Post()
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async create(@CurrentUser() admin: RequestUser, @Body() dto: CreatePartnerDto) {
    const partner = await this.partnersService.create(dto);
    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.PARTNER_CREATED,
      entityType: 'Partner',
      entityId: partner.id,
      metadata: { displayName: partner.displayName },
    });
    return partner;
  }

  @Patch(':id/active')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async setActive(
    @CurrentUser() admin: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
  ) {
    const partner = await this.partnersService.setActive(id, dto.isActive);
    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'Partner',
      entityId: partner.id,
      metadata: { isActive: dto.isActive },
    });
    return partner;
  }
}
