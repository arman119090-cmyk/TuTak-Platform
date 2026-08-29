import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { InitiateTopUpDto } from './dto/initiate-topup.dto';
import { CustomerBalanceService } from './customer-balance.service';

@ApiTags('customer-balance')
@ApiBearerAuth()
@Controller('balance')
export class CustomerBalanceController {
  constructor(private readonly balance: CustomerBalanceService) {}

  @Get('me')
  getMyBalance(@CurrentUser() user: RequestUser) {
    return this.balance.getBalance(user.id);
  }

  @Post('topup')
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
   * nothing at all until a real adapter is wired in.
   */
  @Post('topup/webhook')
  @Public()
  async topUpWebhook(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    await this.balance.confirmTopUpWebhook(body, headers);
    return { received: true };
  }
}
