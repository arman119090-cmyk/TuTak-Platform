import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName, PurchaseIntentStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerApprover, assertPartnerScope } from '../../common/auth/partner-scope';
import { assertResourceBranchScope, branchFilterFor } from '../../common/auth/branch-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { ApprovePurchaseIntentDto } from './dto/approve-purchase-intent.dto';
import { CreatePurchaseIntentDto } from './dto/create-purchase-intent.dto';
import { FindPurchaseIntentByCodeDto } from './dto/find-by-code.dto';
import { QuotePurchaseIntentDto } from './dto/quote-purchase-intent.dto';
import { RefundPurchaseIntentDto } from './dto/refund-purchase-intent.dto';
import { RejectPurchaseIntentDto } from './dto/reject-purchase-intent.dto';
import { PurchaseFundingService } from './purchase-funding.service';
import { PurchaseIntentRefundRequestService } from './purchase-intent-refund-request.service';
import { PurchaseIntentRefundService } from './purchase-intent-refund.service';
import { PurchaseIntentsService } from './purchase-intents.service';

@ApiTags('purchase-intents')
@ApiBearerAuth()
@Controller('purchase-intents')
export class PurchaseIntentsController {
  constructor(
    private readonly purchaseIntents: PurchaseIntentsService,
    private readonly purchaseIntentRefunds: PurchaseIntentRefundService,
    private readonly refundRequests: PurchaseIntentRefundRequestService,
    private readonly funding: PurchaseFundingService,
  ) {}

  /**
   * The server's breakdown of a purchase before it exists — what bonus and
   * stored money cover and what is still due at the till. Declared before
   * `@Get(':id')`/`@Post(':id/...')` for the same routing reason
   * `findByCode` gives. Any authenticated customer, for themselves; the
   * quote reads their own balances and nobody else's.
   */
  @Post('quote')
  quote(@CurrentUser() customer: RequestUser, @Body() dto: QuotePurchaseIntentDto) {
    return this.funding.quote({ ...dto, customerId: customer.id });
  }

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
    return this.purchaseIntents.dailyActivityForPartner(
      partnerId,
      30,
      branchFilterFor(user, partnerId),
    );
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

  /**
   * The cashier takes the money and confirms the sale.
   *
   * The body carries what they read off the pump or the till. Empty for a
   * percentage partner; required for one paid per unit, where the quantity is
   * what the platform's own share is calculated from and a confirm button
   * next to a number nobody read is not approval of that number.
   */
  @Post(':id/confirm')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async confirm(
    @CurrentUser() staff: RequestUser,
    @UuidParam('id') id: string,
    // Defaulted so a percentage partner's till can post an empty body, and
    // so the many suites that drive this controller directly stay honest
    // about what they are testing rather than passing `{}` everywhere.
    @Body() dto: ApprovePurchaseIntentDto = {},
  ) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntents.toDto(await this.purchaseIntents.confirm(id, staff.id, dto));
  }

  /**
   * Staff agree what is being sold, so the customer may pay for it inside
   * TuTak.
   *
   * Only for `TUTAK_PSP` purchases: a provider confirms that money moved and
   * cannot confirm that a sale happened, and on this platform the customer
   * typed the gross and the quantity. Without this step one verified callback
   * would credit the partner, mint the customer's own cashback and pay their
   * referrers for a sale that never took place. A direct purchase needs no
   * separate call — confirming it at the till is the same act.
   */
  @Post(':id/approve-for-payment')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async approveForPayment(
    @CurrentUser() staff: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: ApprovePurchaseIntentDto = {},
  ) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.purchaseIntents.toDto(
      await this.purchaseIntents.approveForPayment(id, staff.id, dto),
    );
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
    // Routed through the request service, not straight at the engine, so
    // this refund leaves the same record an approved request does — see
    // `refundDirectly` for why the path exists at all and what stops it
    // being a way around a cashier who did ask.
    return this.refundRequests.refundDirectly({
      purchaseIntentId: id,
      amount: dto.amount,
      reason: dto.reason,
      actorId: staff.id,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  /**
   * A member of staff states that the cash/card part of a refund was handed
   * back to the customer (§26). Any staff tier scoped to the partner and the
   * branch: handing cash back is till work, and the record is a statement
   * of fact rather than a financial decision — the decision was the refund
   * itself. Declared before `:id/refunds` so the literal segment wins.
   */
  /**
   * The cash the business still has to hand back, across its refunds — what
   * a cashier works through. Declared before `:id` like the other literal
   * routes.
   */
  @Get('refunds/pending-external')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async pendingExternalRefunds(@CurrentUser() staff: RequestUser, @Query('partnerId') partnerId: string) {
    assertPartnerScope(staff, partnerId);
    const rows = await this.purchaseIntentRefunds.listPendingExternal(
      partnerId,
      branchFilterFor(staff, partnerId),
    );
    return rows.map((row) => ({
      id: row.id,
      purchaseIntentId: row.purchaseIntentId,
      confirmationCode: row.purchaseIntent.confirmationCode,
      purchaseGross: row.purchaseIntent.grossAmount.toFixed(4),
      amount: row.amount.toFixed(4),
      bonusRestored: row.bonusRestored.toFixed(4),
      prepaidRestored: row.prepaidRestored.toFixed(4),
      externalRefundDue: row.externalRefundDue.toFixed(4),
      externalRefundStatus: row.externalRefundStatus,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  @Post('refunds/:refundId/confirm-external')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async confirmExternalRefund(
    @CurrentUser() staff: RequestUser,
    @UuidParam('refundId') refundId: string,
  ) {
    const refund = await this.purchaseIntentRefunds.findRefundOrThrow(refundId);
    assertPartnerScope(staff, refund.purchaseIntent.partnerId);
    assertResourceBranchScope(
      staff,
      refund.purchaseIntent.partnerId,
      refund.purchaseIntent.partnerBranchId,
    );
    return this.purchaseIntentRefunds.confirmExternalRefund(refundId, staff.id);
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
