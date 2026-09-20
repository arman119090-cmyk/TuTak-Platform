import { Body, Controller, Get, Patch } from '@nestjs/common';
import { localeSchema } from '@cashout/contracts';
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

  /** Profile plus park resolution: NONE / ACTIVE / CHOOSE. */
  @Get()
  async me(@CurrentUser() user: { userId: string }) {
    return this.drivers.profile(user.userId);
  }

  @Patch('locale')
  async setLocale(
    @CurrentUser() user: { userId: string },
    @Body(zodBody(setLocaleSchema)) dto: { locale: string },
  ) {
    await this.drivers.setLocale(user.userId, dto.locale);
    return { ok: true };
  }

  /** The balance of the active park. Cached for display only; see BalanceService. */
  @Get('balance')
  async balanceOf(@CurrentDriverId() driverId: string) {
    return this.balance.toDto(await this.balance.forDisplay(driverId));
  }

  /** A fresh read, never the cache: what the withdraw screen calls before enabling the button. */
  @Get('balance/fresh')
  async freshBalance(@CurrentDriverId() driverId: string) {
    return this.balance.toDto(await this.balance.requireFresh(driverId));
  }
}
