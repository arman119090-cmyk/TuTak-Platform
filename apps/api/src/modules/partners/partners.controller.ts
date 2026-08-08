import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { hasPartnerScope, isPlatformAdmin } from '../../common/auth/partner-scope';
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

  /**
   * The partner directory.
   *
   * Every authenticated user can read this — a customer has to be able to
   * find where their points are worth something — so what comes back depends
   * on who is asking. Anyone gets name, category, cashback rate and whether
   * the partner is trading. Only a platform administrator gets the rest,
   * which includes tax IDs, individually negotiated commission rates, and
   * whether a business is currently blocked from being paid.
   *
   * The test is `isPlatformAdmin` — a role — and not "holds PARTNER_MANAGE".
   * PARTNER_OWNER holds that permission too, because owners manage *their
   * own* partner: the permission name carries no scope, so checking it here
   * handed every partner owner the commercial terms of every competitor on
   * the platform. That is the same class of mistake as §H5 in
   * docs/AUDIT_2026-08-B.md, and `partner-scope.ts` exists precisely because
   * a permission name is not an authorization decision on its own.
   */
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return isPlatformAdmin(user)
      ? this.partnersService.list()
      : this.partnersService.listPublic();
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    // A partner's own people see their own record in full — the dashboard
    // shows them their tax ID and their commission — but nobody else's.
    // `hasPartnerScope` already lets platform admins through.
    return hasPartnerScope(user, id)
      ? this.partnersService.findByIdOrThrow(id)
      : this.partnersService.findPublicOrThrow(id);
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
