import { Body, Controller, ForbiddenException, Get, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrderDisputeType, PartnerOrderActorType, PartnerOrderOperationalStatus as Op, PermissionName, RoleName } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerScope, isPlatformAdmin } from '../../common/auth/partner-scope';
import { assertResourceBranchScope, branchFilterFor } from '../../common/auth/branch-scope';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequestUser } from '../auth/types/request-user.type';
import { CreatePartnerOrderDto } from './dto/create-partner-order.dto';
import { RejectStockDto } from './dto/reject-stock.dto';
import { SubmitPartnerOrderDto } from './dto/submit-partner-order.dto';
import { CancelPartnerOrderDto } from './dto/cancel-partner-order.dto';
import { CorrectExternalPaymentDto } from './dto/correct-external-payment.dto';
import { AcceptAdjustmentDto } from './dto/accept-adjustment.dto';
import { PartnerOrderQueueFilter, PartnerOrdersService, RECEIPT_ALLOWED_FROM, PRE_HANDOVER } from './partner-orders.service';
import { PartnerOrderAdjustmentService } from './partner-order-adjustment.service';
import { PartnerOrderReturnsService } from './partner-order-returns.service';
import { OrderDisputesService } from './order-disputes.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { DisputeCommentDto } from './dto/dispute-comment.dto';
import { PartnerOrderApiKeyGuard } from './partner-order-api-key.guard';
import { PartnerOrderApiKeyIntegration, PartnerOrderApiKeyPartner } from './partner-order-api-key.decorator';

/**
 * The neutral status a customer sees (spec §19, §69) — never the partner's
 * internal SLA state, never "the shop has not answered for 37 minutes".
 */
export function customerStatusOf(order: {
  operationalStatus: Op;
  sourcingStatus: string;
  paymentStatus: string;
}): string {
  switch (order.operationalStatus) {
    case Op.DRAFT:
      return 'awaiting_confirmation';
    case Op.SUBMITTED:
    case Op.SEEN:
      return 'checking_availability';
    case Op.OUT_OF_STOCK:
      return order.sourcingStatus === 'AWAITING_CUSTOMER' ? 'decision_required' : 'checking_availability';
    case Op.STOCK_CONFIRMED:
      return 'confirmed';
    case Op.HANDED_OVER:
      return 'on_the_way';
    case Op.RECEIVED:
    case Op.COMPLETED:
      return order.paymentStatus === 'REFUNDED' ? 'refunded' : order.paymentStatus === 'PARTIALLY_REFUNDED' ? 'partially_refunded' : 'received';
    case Op.CANCELLED:
      return order.paymentStatus === 'REFUND_PENDING' ? 'cancelled_refund_pending' : 'cancelled';
    case Op.EXPIRED:
      return 'expired';
  }
}

const INTERNAL_FIELDS = [
  'partnerSeenByUserId',
  'stockConfirmedByUserId',
  'stockRejectedByUserId',
  'handedOverByUserId',
  'rejectionReason',
  'cancelledByUserId',
  'manualReviewReason',
  'manualReviewAt',
  'paymentIssueAt',
  'notSeenAlertSentAt',
  'stockAlertLastSentAt',
  'receiptReminderSentAt',
  'commissionRuleId',
  'commissionRateBps',
  'commissionAmount',
  'poolAmount',
  'greenAmount',
  'deferredAmount',
  'programVersion',
  'referrer1Type',
  'referrer1UserId',
  'referrer1PartnerId',
  'referrer1Amount',
  'referrer2Type',
  'referrer2UserId',
  'referrer2PartnerId',
  'referrer2Amount',
  'referrer3Type',
  'referrer3UserId',
  'referrer3PartnerId',
  'referrer3Amount',
  'tutakAmount',
  'completionLedgerTransactionId',
  'submitIdempotencyKey',
  'integrationId',
  'prepaymentRuleId',
] as const;

const INTERNAL_LEG_FIELDS = [
  'bonusReservationId',
  'captureLedgerTransactionId',
  'returnLedgerTransactionId',
  'confirmedByUserId',
  'confirmedShiftId',
  'confirmedBranchId',
  'correctedByUserId',
  'correctedShiftId',
  'correctionReason',
  'returnConfirmedByUserId',
  'returnConfirmedShiftId',
] as const;

/**
 * What a customer may see of their own order: what they buy, from whom, the
 * price, how they pay, the neutral status and what they can do next. Never
 * staff identities, SLA bookkeeping, commission or its distribution (spec
 * §19, §62), or ledger references.
 */
export function toCustomerView<T extends Record<string, unknown>>(order: T) {
  const view: Record<string, unknown> = { ...order };
  for (const f of INTERNAL_FIELDS) delete view[f];
  if (Array.isArray(view.paymentLegs)) {
    view.paymentLegs = (view.paymentLegs as Record<string, unknown>[]).map((leg) => {
      const copy = { ...leg };
      for (const f of INTERNAL_LEG_FIELDS) delete copy[f];
      return copy;
    });
  }
  const op = order.operationalStatus as Op;
  view.customerStatus = customerStatusOf(order as never);
  view.canConfirmReceipt = RECEIPT_ALLOWED_FROM.includes(op);
  view.canCancel = op === Op.DRAFT || PRE_HANDOVER.includes(op);
  view.canOpenDispute = op === Op.RECEIVED || op === Op.COMPLETED || op === Op.HANDED_OVER;
  return view;
}

/**
 * What partner staff see: their order and its money (they are party to the
 * commission contract), but never who referred the customer or how TuTak's
 * share splits further — that is the customer's and TuTak's business.
 */
const PARTNER_HIDDEN_FIELDS = [
  'referrer1UserId',
  'referrer1PartnerId',
  'referrer2UserId',
  'referrer2PartnerId',
  'referrer3UserId',
  'referrer3PartnerId',
  'submitIdempotencyKey',
] as const;

export function toPartnerView<T extends Record<string, unknown>>(order: T) {
  const view: Record<string, unknown> = { ...order };
  for (const f of PARTNER_HIDDEN_FIELDS) delete view[f];
  return view;
}

@ApiTags('partner-orders')
@ApiBearerAuth()
@Controller('partner-orders')
export class PartnerOrdersController {
  constructor(
    private readonly partnerOrders: PartnerOrdersService,
    private readonly adjustments: PartnerOrderAdjustmentService,
    private readonly returns: PartnerOrderReturnsService,
    private readonly disputes: OrderDisputesService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Partner website → TuTak (server-to-server) — spec §3 ────────────────

  @Post()
  @Public()
  @UseGuards(PartnerOrderApiKeyGuard)
  async create(
    @PartnerOrderApiKeyPartner() partnerId: string,
    @PartnerOrderApiKeyIntegration() integrationId: string,
    @Body() dto: CreatePartnerOrderDto,
  ) {
    const order = await this.partnerOrders.create(partnerId, integrationId, dto);
    // The partner's own backend gets the id to build the checkout link
    // (tutak://checkout/<id> or the web checkout) — never TuTak internals.
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      externalOrderId: order.externalOrderId,
      totalAmount: order.totalAmount,
      currency: order.currency,
      operationalStatus: order.operationalStatus,
      paymentStatus: order.paymentStatus,
      draftExpiresAt: order.draftExpiresAt,
    };
  }

  // ── Customer — spec §4, §20-23, §31-34, §43, §69 ───────────────────────

  @Get('mine')
  async listMine(@CurrentUser() customer: RequestUser) {
    const orders = await this.partnerOrders.listForCustomer(customer.id);
    return orders.map((o) => toCustomerView(o));
  }

  @Get(':id/checkout')
  async getCheckout(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    const checkout = await this.partnerOrders.getCheckout(id, customer.id);
    return { ...checkout, order: toCustomerView(checkout.order) };
  }

  /** "Подтвердить заказ". */
  @Post(':id/submit')
  async submit(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string, @Body() dto: SubmitPartnerOrderDto) {
    return toCustomerView(await this.partnerOrders.submit(id, customer.id, dto));
  }

  /** "Получил заказ" — the app asks "Вы подтверждаете, что получили заказ?" first. */
  @Post(':id/received')
  async received(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return toCustomerView(await this.partnerOrders.confirmReceived(id, customer.id));
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string, @Body() dto: CancelPartnerOrderDto) {
    return toCustomerView(await this.partnerOrders.cancelByCustomer(id, customer.id, dto.reason));
  }

  @Post('adjustments/:id/accept')
  async acceptAdjustment(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string, @Body() dto: AcceptAdjustmentDto) {
    return toCustomerView(await this.adjustments.accept(id, customer.id, dto));
  }

  @Post('adjustments/:id/decline')
  async declineAdjustment(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return toCustomerView(await this.adjustments.decline(id, customer.id));
  }

  /** Spec §48: wrong item, damage, mismatch … — after handover. The customer can only open ORDER disputes. */
  @Post(':id/disputes')
  openDisputeAsCustomer(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string, @Body() dto: OpenDisputeDto) {
    return this.disputes.open({
      orderId: id,
      type: OrderDisputeType.ORDER,
      reason: dto.reason,
      description: dto.description,
      disputedAmount: dto.disputedAmount,
      actorId: customer.id,
      actorType: PartnerOrderActorType.CUSTOMER,
    });
  }

  @Get(':id/disputes')
  async listDisputes(@CurrentUser() user: RequestUser, @UuidParam('id') id: string) {
    const order = await this.prisma.partnerOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== user.id) assertResourceBranchScope(user, order.partnerId, order.branchId);
    return this.disputes.listForOrder(id);
  }

  /** Evidence and comments — the customer on their own order, partner staff on theirs. */
  @Post('disputes/:id/comments')
  async commentDispute(@CurrentUser() user: RequestUser, @UuidParam('id') id: string, @Body() dto: DisputeCommentDto) {
    const dispute = await this.prisma.orderDispute.findUnique({ where: { id }, include: { order: true } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    let authorType: PartnerOrderActorType = PartnerOrderActorType.CUSTOMER;
    if (dispute.order.customerId !== user.id) {
      assertResourceBranchScope(user, dispute.order.partnerId, dispute.order.branchId);
      authorType = isPlatformAdmin(user) ? PartnerOrderActorType.ADMIN : PartnerOrderActorType.PARTNER;
    }
    return this.disputes.comment(id, { authorId: user.id, authorType, body: dto.body, attachmentUrls: dto.attachmentUrls });
  }

  // ── Partner Cabinet — spec §16, §24-27, §53-54 ──────────────────────────

  /** Partner A never sees partner B's orders; branch staff see their branches (and branchless orders). */
  @Get()
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  list(
    @CurrentUser() user: RequestUser,
    @Query('partnerId') partnerId: string,
    @Query('filter') filter?: PartnerOrderQueueFilter,
  ) {
    assertPartnerScope(user, partnerId);
    return this.partnerOrders
      .listForPartner(partnerId, filter, branchFilterFor(user, partnerId))
      .then((orders) => orders.map((o) => toPartnerView(o)));
  }

  private async scopedOrder(user: RequestUser, id: string) {
    const order = await this.prisma.partnerOrder.findUnique({ where: { id } });
    if (!order || order.operationalStatus === Op.DRAFT || order.operationalStatus === Op.EXPIRED) {
      throw new NotFoundException('Order not found');
    }
    assertResourceBranchScope(user, order.partnerId, order.branchId);
    return order;
  }

  @Post(':id/seen')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async markSeen(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    await this.scopedOrder(staff, id);
    return toPartnerView(await this.partnerOrders.markSeen(id, staff.id));
  }

  @Post(':id/confirm-stock')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async confirmStock(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    await this.scopedOrder(staff, id);
    return toPartnerView(await this.partnerOrders.confirmStock(id, staff.id));
  }

  @Post(':id/reject-stock')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async rejectStock(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string, @Body() dto: RejectStockDto) {
    await this.scopedOrder(staff, id);
    return toPartnerView(await this.partnerOrders.rejectStock(id, staff.id, dto));
  }

  @Post(':id/handed-over')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async handedOver(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    await this.scopedOrder(staff, id);
    return toPartnerView(await this.partnerOrders.markHandedOver(id, staff.id));
  }

  private async scopedLeg(user: RequestUser, legId: string) {
    const leg = await this.prisma.partnerOrderPaymentLeg.findUnique({ where: { id: legId }, include: { order: true } });
    if (!leg) throw new NotFoundException('Payment not found');
    assertResourceBranchScope(user, leg.order.partnerId, leg.order.branchId);
    return leg;
  }

  /**
   * "Подтвердить внешнюю оплату" (spec §25). The partner can only ever
   * confirm an EXTERNAL leg — the electronic legs' status is TuTak's alone
   * (spec §59) and there is no endpoint that sets it.
   */
  @Post('legs/:id/confirm-external')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async confirmExternal(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    await this.scopedLeg(staff, id);
    return toPartnerView(await this.partnerOrders.confirmExternalPayment(id, staff.id));
  }

  /** Spec §27: OWNER/MANAGER only, before handover, with a reason. */
  @Post('legs/:id/correct-external')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async correctExternal(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string, @Body() dto: CorrectExternalPaymentDto) {
    const leg = await this.scopedLeg(staff, id);
    const partnerId = leg.order.partnerId;
    const isOwnerOrManager =
      isPlatformAdmin(staff) ||
      Boolean(staff.partnerScopes?.[RoleName.PARTNER_OWNER]?.includes(partnerId)) ||
      Boolean(staff.partnerScopes?.[RoleName.PARTNER_MANAGER]?.includes(partnerId));
    if (!isOwnerOrManager) throw new ForbiddenException('Only the owner or a manager may correct a payment confirmation');
    return toPartnerView(await this.partnerOrders.correctExternalPayment(id, staff.id, dto.reason));
  }

  /** Spec §27/§29: after handover a disputed cash confirmation is a PAYMENT dispute; the partner may also open an ORDER one. */
  @Post(':id/partner-disputes')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async openDisputeAsPartner(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string, @Body() dto: OpenDisputeDto) {
    await this.scopedOrder(staff, id);
    return this.disputes.open({
      orderId: id,
      type: dto.type,
      reason: dto.reason,
      description: dto.description,
      disputedAmount: dto.disputedAmount,
      actorId: staff.id,
      actorType: PartnerOrderActorType.PARTNER,
    });
  }

  /** Spec §44-47: a full or partial return after completion — a cash-desk action, on shift. */
  @Post(':id/returns')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async createReturn(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string, @Body() dto: CreateReturnDto) {
    await this.scopedOrder(staff, id);
    return this.returns.createReturn({
      orderId: id,
      amount: dto.amount,
      reason: dto.reason,
      actorId: staff.id,
      actorType: PartnerOrderActorType.PARTNER,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get(':id/returns')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async listReturns(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    await this.scopedOrder(staff, id);
    return this.returns.listForOrder(id);
  }

  @Post('returns/:id/confirm-external-refund')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async confirmReturnExternalRefund(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    const row = await this.prisma.partnerOrderReturn.findUnique({ where: { id }, include: { order: true } });
    if (!row) throw new NotFoundException('Return not found');
    assertResourceBranchScope(staff, row.order.partnerId, row.order.branchId);
    return this.returns.confirmExternalRefund(id, staff.id);
  }

  @Post('legs/:id/confirm-external-return')
  @RequirePermissions(PermissionName.PARTNER_ORDER_MANAGE)
  async confirmExternalReturn(@CurrentUser() staff: RequestUser, @UuidParam('id') id: string) {
    await this.scopedLeg(staff, id);
    return toPartnerView(await this.partnerOrders.confirmExternalReturn(id, staff.id));
  }
}
