import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { requestDriverIdChangeSchema, type RequestDriverIdChangeDto } from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId } from '../auth/auth.decorators';
import { DriverIdService } from './driver-id.service';

@Controller('v1/me/driver-id')
export class DriverIdController {
  constructor(private readonly driverIds: DriverIdService) {}

  /** The current Driver ID, any pending request, and the history of changes. */
  @Get()
  async state(@CurrentDriverId() driverId: string) {
    return this.driverIds.state(driverId);
  }

  /** Ask for a new Driver ID. Verified against the fleet; pending until approved. */
  @Post('requests')
  async request(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(requestDriverIdChangeSchema)) dto: RequestDriverIdChangeDto,
  ) {
    return this.driverIds.request(driverId, dto.newDriverId);
  }

  @Post('requests/:id/cancel')
  @HttpCode(204)
  async cancel(@CurrentDriverId() driverId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.driverIds.cancel(driverId, id);
  }
}
