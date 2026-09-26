import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName, PurchaseIntentStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerScope } from '../../common/auth/partner-scope';
import { assertResourceBranchScope, branchFilterFor } from '../../common/auth/branch-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { CreatePurchaseIntentDto } from './dto/create-purchase-intent.dto';
import { RefundPurchaseIntentDto } from './dto/refund-purchase-intent.dto';
import { RejectPurchaseIntentDto } from './dto/reject-purchase-intent.dto';
import { RefuseShortfallDto, SettleShortfallDto } from '../partner-orders/dto/final-fixes.dto';
import { PurchaseIntentRefundService } from './purchase-intent-refund.service';
import { PurchaseIntentsService } from './purchase-intents.service';

@ApiTags('purchase-intents')
@ApiBearerAuth()
@Controller('purchase-intents')
export class PurchaseIntentsController {
  constructor(
    private readonly purchaseIntents: PurchaseIntentsService,
    private readonly purchaseIntentRefunds: PurchaseIntentRefundService,
  ) {}

  /** Spec §7 steps 1-8. Any authenticated customer, for themselves. */
  @Post()
  async create(@CurrentUser() customer: RequestUser, @Body() dto: CreatePurchaseIntentDto) {
    return this.purchaseIntents.toDto(await this.purchaseIntents.create(dto, customer.id));
  }

  @Get(':id')
  async get(@CurrentUser() user: RequestUser, @UuidParam('id') id: string) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    if (intent.customerId !== user.id) {
      assertResourceBranchScope(user, intent.partnerId, intent.partnerBranchId);
    }
    return this.purchaseIntents.toDto(intent);
  }

  /**
   * The partner's own queue of incoming purchases awaiting confirmation.
   * Branch-A staff never see branch-B's rows here — `branchFilterFor`
   * restricts the query to exactly the branches this caller is assigned to,
   * or to none at all if they are not assigned to any yet.
   */
  @Get()
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async list(
    @CurrentUser() user: RequestUser,
    @Query('partnerId') partnerId: string,
    @Query('status') status?: PurchaseIntentStatus,
  ) {
    assertPartnerScope(user, partnerId);
    const branchIds = branchFilterFor(user, partnerId);
    return this.purchaseIntents.toDtos(
      await this.purchaseIntents.listForPartner(partnerId, status, branchIds),
    );
  }

  /**
   * A partner's own confirmed QR activity, grouped by day — the real-data
   * counterpart to `GET /payouts/partners/:partnerId/settlements`, which
   * only ever has rows for the legacy card-payment pipeline. See
   * `PurchaseIntentsService.dailyActivityForPartner` for why this lives
   * here rather than being folded into that endpoint.
   */
  @Get('activity/daily')
  async dailyActivity(@CurrentUser() user: RequestUser, @Query('partnerId') partnerId: string) {
    assertPartnerScope(user, partnerId);
    return this.purchaseIntents.dailyActivityForPartner(partnerId, 30, branchFilterFor(user, partnerId));
  }

  /**
   * Spec §7 steps 9-11 / §25-26. Any partner staff tier scoped to this
   * intent's partner *and*, when the intent carries one, its branch.
   */
  @Post(':id/confirm')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async confirm(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntents.toDto(await this.purchaseIntents.confirm(id, staff.id));
  }

  @Post(':id/reject')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async reject(
    @CurrentUser() staff: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: RejectPurchaseIntentDto,
  ) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntents.toDto(await this.purchaseIntents.reject(id, staff.id, dto));
  }

  /**
   * A TuTak-side refund of merchandise value against a confirmed purchase —
   * never real money. Gated the same way confirm/reject are: any partner
   * staff tier scoped to this intent's partner (and its branch, if any),
   * since undoing a sale is ordinary work for whoever can process one.
   */
  @Post(':id/refund')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async refund(
    @CurrentUser() staff: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: RefundPurchaseIntentDto,
  ) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntentRefunds.refund({
      purchaseIntentId: id,
      amount: dto.amount,
      reason: dto.reason,
      actorId: staff.id,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  /** Q9: the employee on shift confirms the desk settlement; the refund then executes. */
  @Post('refunds/:refundId/settle-shortfall')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async settleRefundShortfall(
    @CurrentUser() staff: RequestUser,
    @UuidParam('refundId') refundId: string,
    @Body() dto: SettleShortfallDto,
  ) {
    const intent = await this.intentOfRefund(refundId);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntentRefunds.settleShortfall(refundId, staff.id, dto.collectedAmount);
  }

  /** Q9: the customer refuses/disputes — staff at the desk or the customer themself. Nothing moves. */
  @Post('refunds/:refundId/refuse-shortfall')
  async refuseRefundShortfall(
    @CurrentUser() user: RequestUser,
    @UuidParam('refundId') refundId: string,
    @Body() dto: RefuseShortfallDto,
  ) {
    const intent = await this.intentOfRefund(refundId);
    const isCustomer = intent.customerId === user.id;
    if (!isCustomer) assertResourceBranchScope(user, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntentRefunds.refuseShortfall(refundId, { userId: user.id, isCustomer }, dto.note);
  }

  private async intentOfRefund(refundId: string) {
    const refund = await this.purchaseIntentRefunds.findRefundOrThrow(refundId);
    return this.purchaseIntents.findByIdOrThrow(refund.purchaseIntentId);
  }

  @Get(':id/refunds')
  async listRefunds(@CurrentUser() user: RequestUser, @UuidParam('id') id: string) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    if (intent.customerId !== user.id) {
      assertResourceBranchScope(user, intent.partnerId, intent.partnerBranchId);
    }
    return this.purchaseIntentRefunds.listForIntent(id);
  }
}
