import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { upsertAutoPayoutSchema, type UpsertAutoPayoutDto } from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId } from '../auth/auth.decorators';
import { AutoPayoutService } from './auto-payout.service';

@Controller('v1/auto-payout')
export class AutoPayoutController {
  constructor(private readonly autoPayout: AutoPayoutService) {}

  /** The rule (or null) and the server's constraints for the form. */
  @Get()
  async state(@CurrentDriverId() driverId: string) {
    return this.autoPayout.state(driverId);
  }

  /** Enable or change. Carries the driver's PIN/biometric authorization. */
  @Put()
  async upsert(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(upsertAutoPayoutSchema)) dto: UpsertAutoPayoutDto,
  ) {
    return this.autoPayout.upsert(driverId, dto);
  }

  @Post('disable')
  @HttpCode(204)
  async disable(@CurrentDriverId() driverId: string) {
    await this.autoPayout.disable(driverId);
  }
}
