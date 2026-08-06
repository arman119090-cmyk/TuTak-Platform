import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { PartnersService } from './partners.service';

@ApiTags('partners')
@ApiBearerAuth()
@Controller('partners')
export class PartnersController {
  constructor(
    private readonly partnersService: PartnersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  list() {
    return this.partnersService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.partnersService.findByIdOrThrow(id);
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
    @Body('isActive') isActive: boolean,
  ) {
    const partner = await this.partnersService.setActive(id, isActive);
    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'Partner',
      entityId: partner.id,
      metadata: { isActive },
    });
    return partner;
  }
}
