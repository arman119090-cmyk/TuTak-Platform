import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { linkDriverSchema, localeSchema, type LinkDriverDto } from '@cashout/contracts';
import { z } from 'zod';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId, CurrentUser } from '../auth/auth.decorators';
import { BalanceService } from './balance.service';
import { DriversService } from './drivers.service';

const setLocaleSchema = z.object({ locale: localeSchema });

@Controller('v1/me')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly balance: BalanceService,
  ) {}

  @Get()
  async me(@CurrentUser() user: { userId: string }) {
    return this.drivers.profile(user.userId);
  }

  @Post('link')
  async link(
    @CurrentUser() user: { userId: string },
    @Body(zodBody(linkDriverSchema)) dto: LinkDriverDto,
  ) {
    return this.drivers.link(user.userId, dto);
  }

  @Patch('locale')
  async setLocale(
    @CurrentUser() user: { userId: string },
    @Body(zodBody(setLocaleSchema)) dto: { locale: string },
  ) {
    await this.drivers.setLocale(user.userId, dto.locale);
    return { ok: true };
  }

  @Get('balance')
  async balanceOf(@CurrentDriverId() driverId: string) {
    const balance = await this.balance.forDisplay(driverId);
    return {
      available: balance.available.toJSON(),
      reservedByPendingWithdrawals: balance.reserved.toJSON(),
      withdrawable: balance.withdrawable.toJSON(),
      asOf: balance.asOf.toISOString(),
      fresh: balance.fresh,
      staleSeconds: balance.staleSeconds,
    };
  }
}
