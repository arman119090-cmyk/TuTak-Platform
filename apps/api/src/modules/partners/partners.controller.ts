import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  assertPlatformAdmin,
  hasPartnerScope,
  isPlatformAdmin,
} from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { SetActiveDto } from '../admin/dto/set-active.dto';
import { NearbyPartnersQueryDto } from './dto/nearby-partners.query.dto';
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

  /**
   * Where a customer can spend, near where they are standing.
   *
   * Declared before `:id` on purpose. Nest matches routes in the order they
   * are declared, so a `@Get('nearby')` placed after `@Get(':id')` is never
   * reached — "nearby" is a perfectly good id as far as the router is
   * concerned, and the endpoint would 404 with nothing wrong in it.
   *
   * No `@RequirePermissions`. Every signed-in customer needs this; it is the
   * screen that answers "where are my points worth something". What it returns
   * is only what is on the shop's sign — see `NearbyPartnerDto` for what is
   * deliberately left out.
   */
  @Get('nearby')
  nearby(@Query() query: NearbyPartnersQueryDto) {
    return this.partnersService.listNearbyBranches({
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radiusKm ?? 10,
      category: query.category,
      q: query.q,
    });
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

  /**
   * Brings a new tenant onto the platform.
   *
   * `PARTNER_MANAGE` alone is not sufficient and never was: PARTNER_OWNER
   * holds it, so any partner could conjure a new partner — with an accrual
   * rate of their choosing, owned by themselves. That is a funded accrual
   * channel created by the person who benefits from it.
   *
   * There is no partner id to scope this against; the action is about the
   * set of partners, not one of them. So the check is the role.
   */
  @Post()
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async create(@CurrentUser() admin: RequestUser, @Body() dto: CreatePartnerDto) {
    assertPlatformAdmin(admin, 'Creating a partner');
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

  /**
   * Switches a partner on or off.
   *
   * This is the platform's termination control — `findActiveOrThrow` gates
   * redemption on the flag, so switching a partner off stops their QR codes
   * working. Gated on the permission alone, one tenant could shut down a
   * competitor's trading with a single request.
   *
   * Deliberately not extended to "a partner may switch *itself* off": the
   * same endpoint is how fraud and terminations are handled, and a control
   * that the subject of it can also operate is not a control. A partner who
   * wants to stop trading asks the platform.
   */
  @Patch(':id/active')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  async setActive(
    @CurrentUser() admin: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
  ) {
    assertPlatformAdmin(admin, 'Enabling or disabling a partner');
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
