import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartnerOrderStatus, PermissionName } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerScope } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { CreatePartnerOrderDto } from './dto/create-partner-order.dto';
import { RejectStockDto } from './dto/reject-stock.dto';
import { PartnerOrdersService } from './partner-orders.service';
import { PartnerOrderAdjustmentService } from './partner-order-adjustment.service';
import { PartnerOrderApiKeyGuard } from './partner-order-api-key.guard';
import { PartnerOrderApiKeyIntegration, PartnerOrderApiKeyPartner } from './partner-order-api-key.decorator';

/**
 * Never sent to a customer — staff/admin identities, SLA bookkeeping, and
 * anything the commission could be derived from. Spec §17 (no internal
 * ops detail) and spec §24 (a customer has no business reason to see what
 * TuTak's cut of their purchase is): `partnerAmount` is stripped alongside
 * `commissionAmount`/`commissionRateBps`, since `totalAmount - partnerAmount`
 * would otherwise reveal it just as plainly.
 */
function toCustomerView<T extends Record<string, unknown>>(order: T) {
  const {
    partnerSeenByUserId: _a,
    stockConfirmedByUserId: _b,
    stockRejectedByUserId: _c,
    notSeenAlertSentAt: _d,
    stockAlertLastSentAt: _e,
    captureLedgerTransactionId: _f,
    settlementLedgerTransactionId: _g,
    refundLedgerTransactionId: _h,
    commissionRuleId: _i,
    commissionRateBps: _j,
    commissionAmount: _k,
    partnerAmount: _l,
    ...rest
  } = order;
  return rest;
}

@ApiTags('partner-orders')
@ApiBearerAuth()
@Controller('partner-orders')
export class PartnerOrdersController {
  constructor(
    private readonly partnerOrders: PartnerOrdersService,
    private readonly adjustments: PartnerOrderAdjustmentService,
  ) {}

  // ── Partner website → TuTak (M2M) — spec §3 ─────────────────────────────

  @Post()
  @Public()
  @UseGuards(PartnerOrderApiKeyGuard)
  create(
    @PartnerOrderApiKeyPartner() partnerId: string,
    @PartnerOrderApiKeyIntegration() integrationId: string,
    @Body() dto: CreatePartnerOrderDto,
  ) {
    return this.partnerOrders.create(partnerId, integrationId, dto);
  }

  // ── Customer (TuTak Checkout + Мои заказы) — spec §5-6, §18 ─────────────

  @Get('mine')
  listMine(@CurrentUser() customer: RequestUser) {
    return this.partnerOrders.listForCustomer(customer.id).then((orders) => orders.map(toCustomerView));
  }

  @Get(':id/checkout')
  async getCheckout(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    const order = await this.partnerOrders.getCheckoutOrThrow(id, customer.id);
    return toCustomerView(order);
  }

  @Post(':id/pay')
  async pay(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    const result = await this.partnerOrders.pay(id, customer.id);
    return { order: toCustomerView(result.order), insufficientBalance: result.insufficientBalance };
  }

  @Post('adjustments/:id/accept')
  respondAccept(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return this.adjustments.respond(id, customer.id, true);
  }

  @Post('adjustments/:id/decline')
  respondDecline(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return this.adjustments.respond(id, customer.id, false);
  }

  @Post('adjustments/:id/pay-additional')
  payAdditional(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return this.adjustments.payAdditionalAmount(id, customer.id);
  }

  // ── Partner Cabinet — spec §7, §10-12 ───────────────────────────────────

  /** The partner's own incoming-orders queue. Never includes a still-unpaid CREATED order — see `PartnerOrdersService.listForPartner`. */
  @Get()
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  list(
    @CurrentUser() user: RequestUser,
    @Query('partnerId') partnerId: string,
    @Query('status') status?: PartnerOrderStatus,
  ) {
    assertPartnerScope(user, partnerId);
    return this.partnerOrders.listForPartner(partnerId, status);
  }

  @Post(':id/seen')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async markSeen(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    const order = await this.partnerOrders.findByIdOrThrow(id);
    assertPartnerScope(staff, order.partnerId);
    return this.partnerOrders.markSeen(id, staff.id);
  }

  @Post(':id/confirm-stock')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async confirmStock(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    const order = await this.partnerOrders.findByIdOrThrow(id);
    assertPartnerScope(staff, order.partnerId);
    return this.partnerOrders.confirmStock(id, staff.id);
  }

  @Post(':id/reject-stock')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async rejectStock(
    @CurrentUser() staff: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: RejectStockDto,
  ) {
    const order = await this.partnerOrders.findByIdOrThrow(id);
    assertPartnerScope(staff, order.partnerId);
    return this.partnerOrders.rejectStock(id, staff.id, dto);
  }
}
