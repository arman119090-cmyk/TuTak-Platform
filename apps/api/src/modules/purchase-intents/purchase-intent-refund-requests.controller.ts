import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerApprover, assertPartnerScope } from '../../common/auth/partner-scope';
import { assertResourceBranchScope, branchFilterFor } from '../../common/auth/branch-scope';
import { RequestUser } from '../auth/types/request-user.type';
import {
  CreateRefundRequestDto,
  ListRefundRequestsDto,
  RejectRefundRequestDto,
} from './dto/refund-request.dto';
import { PurchaseIntentRefundRequestService } from './purchase-intent-refund-request.service';
import { PurchaseIntentsService } from './purchase-intents.service';

/**
 * The maker/checker half of refunds — see
 * `PurchaseIntentRefundRequestService` for why refunds have one.
 *
 * Its own controller, with its own path, rather than more routes under
 * `/purchase-intents/:id`: those would sit next to a `:id` parameter route
 * and depend on declaration order to not be swallowed by it. A refund
 * request is also its own resource with its own lifetime, and reads as one
 * here.
 */
@ApiTags('purchase-intent-refund-requests')
@ApiBearerAuth()
@Controller('purchase-intent-refund-requests')
export class PurchaseIntentRefundRequestsController {
  constructor(
    private readonly requests: PurchaseIntentRefundRequestService,
    private readonly purchaseIntents: PurchaseIntentsService,
  ) {}

  /**
   * Any member of staff who can work the till can ask for a refund —
   * including the cashier the customer is standing in front of. Asking is
   * not deciding, and nothing financial happens here.
   */
  @Post()
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async create(
    @CurrentUser() staff: RequestUser,
    @Query('purchaseIntentId') purchaseIntentId: string,
    @Body() dto: CreateRefundRequestDto,
  ) {
    const intent = await this.purchaseIntents.findByIdOrThrow(purchaseIntentId);
    assertResourceBranchScope(staff, intent.partnerId, intent.partnerBranchId);
    return this.requests.request({
      purchaseIntentId: intent.id,
      amount: dto.amount,
      reason: dto.reason,
      requestedByUserId: staff.id,
    });
  }

  /**
   * The queue an owner or manager decides from, and the record a cashier can
   * check on what they asked for. Branch-scoped exactly like the purchase
   * queue: branch-A staff never see branch-B's requests.
   */
  @Get()
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async list(@CurrentUser() user: RequestUser, @Query() query: ListRefundRequestsDto) {
    assertPartnerScope(user, query.partnerId);
    return this.requests.listForPartner(
      query.partnerId,
      query.status,
      branchFilterFor(user, query.partnerId),
    );
  }

  /** Owner or manager only, and never the person who asked. */
  @Post(':id/approve')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async approve(@CurrentUser() user: RequestUser, @UuidParam('id') id: string) {
    const request = await this.requests.findOrThrow(id);
    assertPartnerApprover(user, request.partnerId, 'approve a refund');
    assertResourceBranchScope(user, request.partnerId, request.partnerBranchId);
    return this.requests.approve(id, user.id);
  }

  /** Same gate as approving: turning a refund down is also a decision. */
  @Post(':id/reject')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async reject(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: RejectRefundRequestDto,
  ) {
    const request = await this.requests.findOrThrow(id);
    assertPartnerApprover(user, request.partnerId, 'decide a refund');
    assertResourceBranchScope(user, request.partnerId, request.partnerBranchId);
    return this.requests.reject(id, user.id, dto.note);
  }
}
