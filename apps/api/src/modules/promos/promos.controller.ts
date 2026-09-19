import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { PromoEventDto } from './dto/promo-event.dto';
import { PromoLocaleQueryDto } from './dto/promo-locale.query.dto';
import { PromosService, type PartnerPromoPublicDto } from './promos.service';

/**
 * The customer side of Home "Partner Spotlight".
 *
 * Any signed-in customer may read the strip — it is the same for everyone,
 * there is nothing personal in it — and the app reports two things back:
 * that a card was on screen, and that it was tapped. Neither carries who.
 */
@ApiTags('promos')
@ApiBearerAuth()
@Controller('promos')
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  /** `?locale=hy|ru|en` — the app's current interface language. */
  @Get('featured')
  featured(@Query() query: PromoLocaleQueryDto): Promise<PartnerPromoPublicDto[]> {
    return this.promos.featured(query.locale);
  }

  /**
   * Own throttle: a strip of five cards produces at most five impressions
   * and a handful of opens per Home visit. Sixty a minute is generous for a
   * person and cheap for anyone trying to inflate a partner's numbers.
   */
  @Post(':id/events')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async event(@UuidParam('id') id: string, @Body() dto: PromoEventDto): Promise<void> {
    await this.promos.recordEvent(id, dto.type);
  }
}
