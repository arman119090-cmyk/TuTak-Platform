import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { assertPartnerScope } from '../../common/auth/partner-scope';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/request-user.type';
import { SettlementService } from '../settlement/settlement.service';
import { ConfirmPayoutDto, FailPayoutDto, RequestPayoutDto } from './dto/request-payout.dto';
import { PayoutEngineService } from './payout-engine.service';

/**
 * Reads are partner-scoped; writes are platform-admin only.
 *
 * A partner can see what they are owed and what has been paid — that is
 * their own money and withholding it serves nobody. What they cannot do is
 * initiate the transfer: `PAYOUT_MANAGE` is deliberately not granted to
 * ADMIN either, only SUPER_ADMIN, because wiring money to an external bank
 * account is the least reversible action on this platform and there is no
 * maker-checker flow yet to hand it out more widely.
 */
@ApiTags('payouts')
@ApiBearerAuth()
@Controller('payouts')
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutEngineService,
    private readonly settlement: SettlementService,
    private readonly audit: AuditService,
  ) {}

  @Get('partners/:partnerId/balance')
  async balance(@CurrentUser() user: RequestUser, @Param('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    const available = await this.payouts.availableBalance(partnerId);
    return { partnerId, availableBalance: available.toFixed(4), currency: 'AMD' };
  }

  // `async` on both of these is deliberate, not incidental. Without it the
  // scope check throws synchronously — before a promise exists — so a caller
  // has to handle both a thrown error and a rejected promise from the same
  // method, while the sibling `balance` above only ever rejects. Nest copes
  // with either; a caller reading the class should not have to.
  @Get('partners/:partnerId/settlements')
  async settlements(@CurrentUser() user: RequestUser, @Param('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.settlement.listForPartner(partnerId);
  }

  @Get('partners/:partnerId')
  async list(@CurrentUser() user: RequestUser, @Param('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.payouts.listForPartner(partnerId);
  }

  @Post()
  @RequirePermissions(PermissionName.PAYOUT_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async request(@CurrentUser() admin: RequestUser, @Body() dto: RequestPayoutDto) {
    const result = await this.payouts.requestPayout({
      partnerId: dto.partnerId,
      amount: dto.amount,
      actorId: admin.id,
      idempotencyKey: dto.idempotencyKey,
    });

    await this.audit.record({
      actorUserId: admin.id,
      action: AuditAction.PAYOUT_REQUESTED,
      entityType: 'Payout',
      entityId: result.payoutId,
      metadata: {
        partnerId: dto.partnerId,
        amount: result.amount,
        remainingBalance: result.remainingBalance,
      },
    });

    return result;
  }

  @Post(':id/confirm')
  @RequirePermissions(PermissionName.PAYOUT_MANAGE)
  async confirm(
    @CurrentUser() admin: RequestUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPayoutDto,
  ) {
    await this.payouts.confirmPaid(id, dto.bankReference);
    await this.audit.record({
      actorUserId: admin.id,
      action: AuditAction.PAYOUT_RESOLVED,
      entityType: 'Payout',
      entityId: id,
      metadata: { outcome: 'PAID', bankReference: dto.bankReference },
    });
    return { success: true };
  }

  @Post(':id/fail')
  @RequirePermissions(PermissionName.PAYOUT_MANAGE)
  async fail(
    @CurrentUser() admin: RequestUser,
    @Param('id') id: string,
    @Body() dto: FailPayoutDto,
  ) {
    await this.payouts.markFailed(id, dto.failureReason);
    await this.audit.record({
      actorUserId: admin.id,
      action: AuditAction.PAYOUT_RESOLVED,
      entityType: 'Payout',
      entityId: id,
      metadata: { outcome: 'FAILED', failureReason: dto.failureReason },
    });
    return { success: true };
  }
}
