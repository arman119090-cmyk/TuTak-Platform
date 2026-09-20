import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { CustomerBalanceService } from './customer-balance.service';

/**
 * The read side of a customer's stored money.
 *
 * Always registered, unlike the top-up controller, and gated per request:
 * a deployment where the balance can be used for nothing — neither funded
 * nor spent on a purchase, which is production today — answers 404, so
 * there is still no balance surface to find. Per request rather than at
 * module load because `@Module()` metadata is read when the file is
 * imported, before any test or deployment gets to decide the flags, and a
 * read route whose existence depends on import order is not a route
 * anybody can reason about.
 */
@ApiTags('customer-balance')
@ApiBearerAuth()
@Controller('balance')
export class CustomerBalanceController {
  constructor(private readonly balance: CustomerBalanceService) {}

  /**
   * Available, reserved, book — and which of the two capabilities this
   * deployment has switched on, so the app renders "top up" only where a
   * top-up can happen and never shows an unavailable balance as zero.
   */
  @Get('me')
  async getMyBalance(@CurrentUser() user: RequestUser) {
    if (!this.balance.purchasesEnabled() && !this.balance.topUpsEnabled()) {
      throw new NotFoundException();
    }
    const detail = await this.balance.getBalanceDetail(user.id);
    return {
      ...detail,
      // Kept for every client that read the old single-number shape.
      balance: detail.available,
      purchasesEnabled: this.balance.purchasesEnabled(),
      topUpsEnabled: this.balance.topUpsEnabled(),
    };
  }
}
