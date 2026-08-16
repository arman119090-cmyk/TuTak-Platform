import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName, PurchaseIntentStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { assertPartnerScope, hasPartnerScope } from '../../common/auth/partner-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { CreatePurchaseIntentDto } from './dto/create-purchase-intent.dto';
import { RejectPurchaseIntentDto } from './dto/reject-purchase-intent.dto';
import { PurchaseIntentsService } from './purchase-intents.service';

@ApiTags('purchase-intents')
@ApiBearerAuth()
@Controller('purchase-intents')
export class PurchaseIntentsController {
  constructor(private readonly purchaseIntents: PurchaseIntentsService) {}

  /** Spec §7 steps 1-8. Any authenticated customer, for themselves. */
  @Post()
  create(@CurrentUser() customer: RequestUser, @Body() dto: CreatePurchaseIntentDto) {
    return this.purchaseIntents.create(dto, customer.id);
  }

  @Get(':id')
  async get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    if (intent.customerId !== user.id && !hasPartnerScope(user, intent.partnerId)) {
      throw new ForbiddenException('You may not view this purchase intent');
    }
    return intent;
  }

  /** The partner's own queue of incoming purchases awaiting confirmation. */
  @Get()
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  list(
    @CurrentUser() user: RequestUser,
    @Query('partnerId') partnerId: string,
    @Query('status') status?: PurchaseIntentStatus,
  ) {
    assertPartnerScope(user, partnerId);
    return this.purchaseIntents.listForPartner(partnerId, status);
  }

  /** Spec §7 steps 9-11 / §25-26. Any partner staff tier scoped to this intent's partner. */
  @Post(':id/confirm')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async confirm(@CurrentUser() staff: RequestUser, @Param('id') id: string) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertPartnerScope(staff, intent.partnerId);
    return this.purchaseIntents.confirm(id, staff.id);
  }

  @Post(':id/reject')
  @RequirePermissions(PermissionName.PURCHASE_INTENT_CONFIRM)
  async reject(
    @CurrentUser() staff: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectPurchaseIntentDto,
  ) {
    const intent = await this.purchaseIntents.findByIdOrThrow(id);
    assertPartnerScope(staff, intent.partnerId);
    return this.purchaseIntents.reject(id, staff.id, dto);
  }
}
