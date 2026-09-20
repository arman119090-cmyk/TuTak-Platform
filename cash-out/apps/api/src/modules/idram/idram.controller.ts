import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { linkIdramAccountSchema, type LinkIdramAccountDto } from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId } from '../auth/auth.decorators';
import { IdramService } from './idram.service';

@Controller('v1/idram/account')
export class IdramController {
  constructor(private readonly idram: IdramService) {}

  /** The active payout destination, masked. `null` when none is linked. */
  @Get()
  async current(@CurrentDriverId() driverId: string) {
    return { account: await this.idram.current(driverId) };
  }

  /** Link, or replace, the iDram account. Verified with the provider first. */
  @Post()
  async link(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(linkIdramAccountSchema)) dto: LinkIdramAccountDto,
  ) {
    return this.idram.link(driverId, dto);
  }

  @Delete()
  @HttpCode(204)
  async unlink(@CurrentDriverId() driverId: string) {
    await this.idram.unlink(driverId);
  }
}
