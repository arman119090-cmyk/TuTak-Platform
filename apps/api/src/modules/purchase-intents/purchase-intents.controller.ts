import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName, PurchaseIntentStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerApprover, assertPartnerScope } from '../../common/auth/partner-scope';
import { assertResourceBranchScope, branchFilterFor } from '../../common/auth/branch-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { CreatePurchaseIntentDto } from './dto/create-purchase-intent.dto';
import { FindPurchaseIntentByCodeDto } from './dto/find-by-code.dto';
import { RefundPurchaseIntentDto } from './dto/refund-purchase-intent.dto';
import { RejectPurchaseIntentDto } from './dto/reject-purchase-intent.dto';
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

  /**
   * Find the live purchase a four-digit till code belongs to.
   *
   * Declared before `@Get(':id')` deliberately: Nest matches routes in
   * declaration order, and a path parameter would otherwise swallow this
   * one.
   *
   * The code is a disambiguator and grants nothing by itself — this is
   * gated exactly like the queue it is an alternative to: the same
   * confirm permission, the same partner scope, and the branch scope
   * applied to the row that comes back, so a cashier cannot pull a
   * purchase from a branch they are not assigned to.
   */
  @Get('by-code')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async findByCode(@CurrentUser() staff: RequestUser, @Query() query: FindPurchaseIntentByCodeDto) {
    assertPartnerScope(staff, query.partnerId);
    const intent = await this.purchaseIntents.findActiveByCode(query.partnerId, query.code);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntents.toDto(intent);
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
  /**
   * The customer's own way out of a purchase nobody has confirmed yet.
   *
   * No `@RequirePermissions`: this is the customer's action on their own
   * record, exactly like `POST /purchase-intents`, and the ownership check
   * lives in the service so it cannot be bypassed by another route
   * reaching the same method.
   */
  @Post(':id/cancel')
  async cancel(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return this.purchaseIntents.toDto(await this.purchaseIntents.cancel(id, customer.id));
  }

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
   * never real money.
   *
   * Owner or manager only, as of the maker/checker decision of 2026-09-12.
   * It used to be gated the same way confirm/reject are — any staff tier
   * scoped to the partner — on the reasoning that undoing a sale is ordinary
   * work for whoever can process one. It is not: a refund restores the
   * customer's spent bonus and claws back the referral and deferred shares
   * that other people may already have spent, and at a till with shift work
   * that is not a decision to leave with a single cashier's tap.
   *
   * Staff who are not owners or managers use
   * `POST /purchase-intent-refund-requests` instead, and an owner or manager
   * decides. This route stays for the case that flow cannot serve: an owner
   * of a business with no second person to ask. That is one person taking
   * one decision openly, which is honest; approving your own request would
   * be the same person pretending to be two, which is why
   * `PurchaseIntentRefundRequestService.approve` refuses it.
   */
  @Post(':id/refund')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async refund(
    @CurrentUser() staff: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: RefundPurchaseIntentDto,
  ) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertPartnerApprover(staff, intent.partnerId, 'refund a purchase directly');
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntentRefunds.refund({
      purchaseIntentId: id,
      amount: dto.amount,
      reason: dto.reason,
      actorId: staff.id,
      idempotencyKey: dto.idempotencyKey,
    });
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
