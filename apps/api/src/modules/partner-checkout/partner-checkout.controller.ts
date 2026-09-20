import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { PurchaseIntentsService } from '../purchase-intents/purchase-intents.service';
import { ClaimPartnerCheckoutDto } from './dto/claim-partner-checkout.dto';
import { CreatePartnerCheckoutDto } from './dto/create-partner-checkout.dto';
import { PartnerApi, PartnerApiIdentity, PartnerApiKeyGuard } from './partner-api-key.guard';
import { PartnerCheckoutService } from './partner-checkout.service';

/**
 * Two audiences on one resource. The till (M2M, `x-api-key`) opens, reads,
 * cancels and confirms; the customer (JWT) resolves a scanned token and
 * claims it. Literal segments (`resolve`, `claim`) are declared before
 * `:id` so a path parameter never swallows them.
 */
@ApiTags('partner-checkouts')
@Controller('partner-checkouts')
export class PartnerCheckoutController {
  constructor(
    private readonly checkouts: PartnerCheckoutService,
    private readonly purchaseIntents: PurchaseIntentsService,
  ) {}

  // ── Customer ────────────────────────────────────────────────────────────

  @Get('resolve/:token')
  @ApiBearerAuth()
  resolve(@Param('token') token: string) {
    return this.checkouts.resolve(token);
  }

  @Post('claim/:token')
  @ApiBearerAuth()
  async claim(
    @CurrentUser() customer: RequestUser,
    @Param('token') token: string,
    @Body() dto: ClaimPartnerCheckoutDto,
  ) {
    return this.purchaseIntents.toDto(await this.checkouts.claim(token, customer.id, dto));
  }

  // ── Till (M2M) ──────────────────────────────────────────────────────────

  @Post()
  @Public()
  @UseGuards(PartnerApiKeyGuard)
  create(@PartnerApi() identity: PartnerApiIdentity, @Body() dto: CreatePartnerCheckoutDto) {
    return this.checkouts.create(identity, dto);
  }

  @Get(':id')
  @Public()
  @UseGuards(PartnerApiKeyGuard)
  status(@PartnerApi() identity: PartnerApiIdentity, @UuidParam('id') id: string) {
    return this.checkouts.statusForPartner(identity, id);
  }

  @Post(':id/cancel')
  @Public()
  @UseGuards(PartnerApiKeyGuard)
  cancel(@PartnerApi() identity: PartnerApiIdentity, @UuidParam('id') id: string) {
    return this.checkouts.cancel(identity, id);
  }

  @Post(':id/confirm')
  @Public()
  @UseGuards(PartnerApiKeyGuard)
  confirm(@PartnerApi() identity: PartnerApiIdentity, @UuidParam('id') id: string) {
    return this.checkouts.confirm(identity, id);
  }
}
