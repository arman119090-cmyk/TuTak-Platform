import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { activateParkSchema, type ActivateParkDto } from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId, CurrentUser } from '../auth/auth.decorators';
import { MembershipService } from './membership.service';

/** The driver's own view of their parks. */
@Controller('v1/me/parks')
export class MeParksController {
  constructor(private readonly memberships: MembershipService) {}

  @Get()
  async list(@CurrentDriverId() driverId: string) {
    return { items: await this.memberships.list(driverId) };
  }

  /**
   * Choose (or change) the active park. The server verifies eligibility;
   * a denial leaves the previous park active.
   */
  @Post('activate')
  @HttpCode(200)
  async activate(
    @CurrentDriverId() driverId: string,
    @CurrentUser() user: { userId: string },
    @Body(zodBody(activateParkSchema)) dto: ActivateParkDto,
  ) {
    await this.memberships.activate(driverId, dto.parkId, 'DRIVER', user.userId);
    return this.memberships.resolve(user.userId);
  }
}
