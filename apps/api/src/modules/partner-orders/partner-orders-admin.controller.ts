import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrderEscalationType, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPlatformAdmin } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { SourcingTaskService } from './sourcing-task.service';
import { OrderEscalationService } from './order-escalation.service';
import { CommerceRulesService } from './commerce-rules.service';
import { AdminQueue, PartnerOrdersService } from './partner-orders.service';
import { RecordSourcingResultDto } from './dto/record-sourcing-result.dto';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { CreatePrepaymentRuleDto } from './dto/create-prepayment-rule.dto';
import { AdminOrderActionDto } from './dto/admin-order-action.dto';
import { OrderDisputesService } from './order-disputes.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputeCommentDto } from './dto/dispute-comment.dto';
import { DecideCancellationCostDto, ReviewShortfallDto } from './dto/final-fixes.dto';
import { PartnerOrderCancellationService } from './partner-order-cancellation.service';
import { PartnerOrderReturnsService } from './partner-order-returns.service';
import { PurchaseIntentRefundService } from '../purchase-intents/purchase-intent-refund.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * TuTak's own side of Partner Commerce: the operator queues (spec §55,
 * §76), sourcing (§36-37), SLA escalations (§17-18), manual review (§34),
 * and the commercial configuration (Q5, §30). Every route is platform-only:
 * queues/sourcing/escalations behind `PARTNER_ORDER_OPERATE`, and the rules
 * additionally behind `assertPlatformAdmin` — `PARTNER_MANAGE` alone is
 * held by partner owners, and a partner must never be able to change its
 * own commission (spec §62; v1 let it — fixed).
 */
@ApiTags('admin/partner-orders')
@ApiBearerAuth()
@Controller('admin/partner-orders')
export class PartnerOrdersAdminController {
  constructor(
    private readonly orders: PartnerOrdersService,
    private readonly sourcingTasks: SourcingTaskService,
    private readonly escalations: OrderEscalationService,
    private readonly rules: CommerceRulesService,
    private readonly disputes: OrderDisputesService,
    private readonly cancellations: PartnerOrderCancellationService,
    private readonly returns: PartnerOrderReturnsService,
    private readonly qrRefunds: PurchaseIntentRefundService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Cancellation cost review — item 8 ───────────────────────────────────

  @Get('cancellations')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  listCancellationReviews(@CurrentUser() admin: RequestUser) {
    assertPlatformAdmin(admin, 'Cancellation reviews');
    return this.cancellations.listForReview();
  }

  /** The most that can be approved: the real money on the order (never charged beyond it). */
  @Get(':id/cancellation-cost-cap')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  cancellationCostCap(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string) {
    assertPlatformAdmin(admin, 'Cancellation reviews');
    return this.cancellations.costCap(id);
  }

  /** Approve / reduce / reject an actual-cost claim. Claim on COST_REVIEW — two admins, one decision. */
  @Post('cancellations/:id/decide')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  decideCancellation(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: DecideCancellationCostDto) {
    assertPlatformAdmin(admin, 'Deciding a cancellation cost');
    return this.cancellations.decide(id, admin.id, dto);
  }

  // ── Return shortfall reviews — Q9 ────────────────────────────────────────

  @Get('return-reviews')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  async listReturnReviews(@CurrentUser() admin: RequestUser) {
    assertPlatformAdmin(admin, 'Return reviews');
    const [online, qr] = await Promise.all([this.returns.listAwaitingReview(), this.qrRefunds.listAwaitingReview()]);
    return { online, qr };
  }

  @Post('returns/:id/review')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  reviewReturn(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: ReviewShortfallDto) {
    assertPlatformAdmin(admin, 'Return reviews');
    return this.returns.reviewShortfall(id, admin.id, dto.decision, dto.note);
  }

  @Post('purchase-intent-refunds/:id/review')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  reviewQrRefund(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: ReviewShortfallDto) {
    assertPlatformAdmin(admin, 'Return reviews');
    return this.qrRefunds.reviewShortfall(id, admin.id, dto.decision, dto.note);
  }

  /** Q8: open referral withholdings — who owes what, to whose commission refund. Read-only. */
  @Get('referral-withholdings')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  listWithholdings(@CurrentUser() admin: RequestUser, @Query('status') status: 'OPEN' | 'SETTLED' = 'OPEN') {
    assertPlatformAdmin(admin, 'Referral withholdings');
    return this.prisma.referralWithholding.findMany({
      where: { status },
      include: { recoveries: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }

  // ── Disputes — spec §29, §48-49 ─────────────────────────────────────────

  @Get('disputes')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  listDisputes(@CurrentUser() admin: RequestUser) {
    assertPlatformAdmin(admin, 'Disputes');
    return this.disputes.listOpen();
  }

  @Post('disputes/:id/comments')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  commentDispute(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: DisputeCommentDto) {
    assertPlatformAdmin(admin, 'Disputes');
    return this.disputes.comment(id, { authorId: admin.id, authorType: 'ADMIN', body: dto.body, attachmentUrls: dto.attachmentUrls });
  }

  /** Only a TuTak admin decides; idempotent and safe against a second admin (claim on OPEN). */
  @Post('disputes/:id/resolve')
  @RequirePermissions(PermissionName.ORDER_DISPUTE_RESOLVE)
  resolveDispute(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: ResolveDisputeDto) {
    assertPlatformAdmin(admin, 'Resolving a dispute');
    return this.disputes.resolve(id, admin.id, dto);
  }

  // ── Queues — spec §55 ────────────────────────────────────────────────────

  @Get('queue')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  queue(@CurrentUser() admin: RequestUser, @Query('queue') queue: AdminQueue = 'all') {
    assertPlatformAdmin(admin, 'The Partner Commerce queue');
    return this.orders.listAdminQueue(queue);
  }

  /** Manual review outcome — the customer confirmed by phone, etc. Audited with the reason. */
  @Post(':id/confirm-received')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  confirmReceived(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: AdminOrderActionDto) {
    assertPlatformAdmin(admin, 'Confirming receipt on the customer’s behalf');
    return this.orders.confirmReceivedByAdmin(id, admin.id, dto.reason);
  }

  @Post(':id/cancel')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  cancel(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: AdminOrderActionDto) {
    assertPlatformAdmin(admin, 'Cancelling an order');
    return this.orders.cancelByAdmin(id, admin.id, dto.reason);
  }

  // ── Sourcing — spec §36-37 ───────────────────────────────────────────────

  @Get('sourcing-tasks')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  listSourcingTasks(@CurrentUser() admin: RequestUser) {
    assertPlatformAdmin(admin, 'Sourcing');
    return this.sourcingTasks.listOpen();
  }

  @Post('sourcing-tasks/:id/claim')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  claimSourcingTask(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string) {
    assertPlatformAdmin(admin, 'Sourcing');
    return this.sourcingTasks.claim(id, admin.id);
  }

  @Post('sourcing-tasks/:id/result')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  recordSourcingResult(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string, @Body() dto: RecordSourcingResultDto) {
    assertPlatformAdmin(admin, 'Sourcing');
    return this.sourcingTasks.recordResult(id, dto, admin.id);
  }

  // ── Escalations — spec §17-18 ────────────────────────────────────────────

  @Get('escalations')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  listEscalations(@CurrentUser() admin: RequestUser, @Query('type') type?: OrderEscalationType) {
    assertPlatformAdmin(admin, 'Escalations');
    return this.escalations.listOpen(type);
  }

  /** "Взял в работу". */
  @Post('escalations/:id/claim')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  claimEscalation(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string) {
    assertPlatformAdmin(admin, 'Escalations');
    return this.escalations.claim(id, admin.id);
  }

  @Post('escalations/:id/resolve')
  @RequirePermissions(PermissionName.PARTNER_ORDER_OPERATE)
  resolveEscalation(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string) {
    assertPlatformAdmin(admin, 'Escalations');
    return this.escalations.resolve(id, admin.id);
  }

  // ── Commercial configuration — Q5, spec §12, §30 ────────────────────────

  @Get('commission-rules')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  listCommissionRules(@CurrentUser() admin: RequestUser, @Query('partnerId') partnerId?: string) {
    assertPlatformAdmin(admin, 'Commission rules');
    return this.rules.listCommissionRules(partnerId);
  }

  @Post('commission-rules')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  createCommissionRule(@CurrentUser() admin: RequestUser, @Body() dto: CreateCommissionRuleDto) {
    assertPlatformAdmin(admin, 'Commission rules');
    return this.rules.createCommissionRule({ ...dto, actorUserId: admin.id });
  }

  @Post('commission-rules/:id/deactivate')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  deactivateCommissionRule(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string) {
    assertPlatformAdmin(admin, 'Commission rules');
    return this.rules.deactivateCommissionRule(id, admin.id);
  }

  @Get('prepayment-rules')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  listPrepaymentRules(@CurrentUser() admin: RequestUser, @Query('partnerId') partnerId?: string) {
    assertPlatformAdmin(admin, 'Prepayment rules');
    return this.rules.listPrepaymentRules(partnerId);
  }

  @Post('prepayment-rules')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  createPrepaymentRule(@CurrentUser() admin: RequestUser, @Body() dto: CreatePrepaymentRuleDto) {
    assertPlatformAdmin(admin, 'Prepayment rules');
    return this.rules.createPrepaymentRule({ ...dto, actorUserId: admin.id });
  }

  @Post('prepayment-rules/:id/deactivate')
  @RequirePermissions(PermissionName.PARTNER_MANAGE)
  deactivatePrepaymentRule(@CurrentUser() admin: RequestUser, @UuidParam('id') id: string) {
    assertPlatformAdmin(admin, 'Prepayment rules');
    return this.rules.deactivatePrepaymentRule(id, admin.id);
  }
}
