import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName, SettlementPeriod } from '@prisma/client';
import { IsIn } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerScope, assertPlatformAdmin } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { PartnerSettlementStatementService } from './partner-settlement-statement.service';

export class SetSettlementPeriodDto {
  @IsIn(Object.values(SettlementPeriod))
  period: SettlementPeriod;
}

/**
 * Spec §50-52, §77: the partner's settlement view — read-only. There is no
 * withdraw endpoint anywhere; money moves only through the existing
 * dual-control payouts/collections. The settlement period is a platform
 * admin setting, never the partner's own.
 */
@ApiTags('settlement')
@ApiBearerAuth()
@Controller('settlement')
export class PartnerSettlementController {
  constructor(private readonly statements: PartnerSettlementStatementService) {}

  @Get('partners/:partnerId/summary')
  @RequirePermissions(PermissionName.PARTNER_TRANSACTIONS_READ)
  summary(@CurrentUser() user: RequestUser, @UuidParam('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.statements.balanceSummary(partnerId);
  }

  @Get('partners/:partnerId/statements')
  @RequirePermissions(PermissionName.PARTNER_TRANSACTIONS_READ)
  list(@CurrentUser() user: RequestUser, @UuidParam('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.statements.list(partnerId);
  }

  @Get('statements/:id')
  @RequirePermissions(PermissionName.PARTNER_TRANSACTIONS_READ)
  async get(@CurrentUser() user: RequestUser, @UuidParam('id') id: string) {
    const statement = await this.statements.get(id);
    assertPartnerScope(user, statement.partnerId);
    return statement;
  }

  @Post('partners/:partnerId/period')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  setPeriod(@CurrentUser() admin: RequestUser, @UuidParam('partnerId') partnerId: string, @Body() dto: SetSettlementPeriodDto) {
    assertPlatformAdmin(admin, 'Changing a partner settlement period');
    return this.statements.setPeriod(partnerId, dto.period, admin.id);
  }
}
