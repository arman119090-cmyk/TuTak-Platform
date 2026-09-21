import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { InitiateTopUpDto } from './dto/initiate-topup.dto';
import { CustomerBalanceService } from './customer-balance.service';

/**
 * The paying-in half. Registered only with `CUSTOMER_PREPAID_TOPUP_ENABLED`
 * — see `CustomerBalanceModule` for why absence, not refusal, is the safe
 * default. Nothing here credits a balance on anything but the provider's
 * verified answer (`confirmTopUpWebhook`).
 */
@ApiTags('customer-balance')
@ApiBearerAuth()
@Controller('balance/topup')
export class CustomerBalanceTopUpController {
  constructor(private readonly balance: CustomerBalanceService) {}

  @Post()
  initiateTopUp(@CurrentUser() user: RequestUser, @Body() dto: InitiateTopUpDto) {
    return this.balance.initiateTopUp(user.id, dto.amount, dto.idempotencyKey);
  }

  /**
   * The provider-facing half of the top-up flow — the bank calls this, not
   * a logged-in customer, so it is `@Public()` (no TuTak session) exactly
   * like `RoamingCpoController`'s own M2M routes. Unlike those, this one
   * has no API-key guard in front of it: verification is the configured
   * `BankTopUpAdapter`'s own job (`verifyTopUpWebhook`), because a real
   * bank's signature scheme is provider-specific in a way an API key isn't
   * — the No-op adapter always returns null here, so this route does
   * nothing at all until a real adapter is wired in. Declared before
   * `:id` so the literal segment wins.
   */
  @Post('webhook')
  @Public()
  async topUpWebhook(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    await this.balance.confirmTopUpWebhook(body, headers);
    return { received: true };
  }

  /**
   * Where one of the customer's own top-ups stands — the status query the
   * app polls after coming back from the provider. `UNRESOLVED` comes back
   * as itself.
   */
  @Get(':id')
  getTopUp(@CurrentUser() user: RequestUser, @UuidParam('id') id: string) {
    return this.balance.getTopUpStatus(user.id, id);
  }
}
