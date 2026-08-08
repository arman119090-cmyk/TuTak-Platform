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
import { RecordAcquirerSettlementDto } from './dto/record-acquirer-settlement.dto';
import { PayoutEngineService } from './payout-engine.service';
import { AcquirerSettlementService } from './acquirer-settlement.service';

/**
 * Reads are partner-scoped; writes are platform-admin only.
 *
 * A partner can see what they are owed and what has been paid — that is
 * their own money and withholding it serves nobody. What they cannot do is
 * initiate the transfer: `PAYOUT_MANAGE` is deliberately not granted to
 * ADMIN either, only SUPER_ADMIN, because wiring money to an external bank
 * account is the least reversible action on this platform.
 *
 * On top of that permission, confirming a payout is subject to the
 * two-person rule enforced in `PayoutEngineService.confirmPaid`: the
 * confirming admin must not be the one who requested it.
 */
@ApiTags('payouts')
@ApiBearerAuth()
@Controller('payouts')
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutEngineService,
    private readonly acquirerSettlements: AcquirerSettlementService,
    private readonly settlement: SettlementService,
    private readonly audit: AuditService,
  ) {}

  // ── Money arriving from the acquirer ──────────────────────────────────
  //
  // Gated on PAYOUT_MANAGE, the same permission as sending money out.
  // Recording an inbound settlement is the one route by which cash appears
  // in the books without a customer transaction behind it, so a false entry
  // makes the platform believe it holds money it does not — which is the
  // same class of harm as an unauthorised transfer out, and deserves the
  // same level of trust.

  @Get('acquirer/outstanding')
  @RequirePermissions(PermissionName.LEDGER_READ)
  async outstandingReceivable() {
    const outstanding = await this.acquirerSettlements.outstandingReceivable();
    return { outstandingReceivable: outstanding.toFixed(4), currency: 'AMD' };
  }

  @Get('acquirer/settlements')
  @RequirePermissions(PermissionName.LEDGER_READ)
  listAcquirerSettlements() {
    return this.acquirerSettlements.list();
  }

  @Post('acquirer/settlements')
  @RequirePermissions(PermissionName.PAYOUT_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async recordAcquirerSettlement(
    @CurrentUser() admin: RequestUser,
    @Body() dto: RecordAcquirerSettlementDto,
  ) {
    const result = await this.acquirerSettlements.record({
      amount: dto.amount,
      reference: dto.reference,
      settledOn: new Date(dto.settledOn),
      actorId: admin.id,
      idempotencyKey: dto.idempotencyKey,
    });

    await this.audit.record({
      actorUserId: admin.id,
      action: AuditAction.ACQUIRER_SETTLEMENT_RECORDED,
      entityType: 'AcquirerSettlement',
      entityId: result.settlementId,
      metadata: { amount: result.amount, reference: dto.reference },
    });

    return result;
  }

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
    await this.payouts.confirmPaid(id, dto.bankReference, admin.id);
    await this.audit.record({
      actorUserId: admin.id,
      action: AuditAction.PAYOUT_RESOLVED,
      entityType: 'Payout',
      entityId: id,
      metadata: { outcome: 'PAID', bankReference: dto.bankReference, confirmedBy: admin.id },
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
