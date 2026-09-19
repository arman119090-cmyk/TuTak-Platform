import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { addPayoutMethodSchema, type AddPayoutMethodDto } from '@cashout/contracts';
import { zodBody } from '../../common/zod.pipe';
import { CurrentDriverId } from '../auth/auth.decorators';
import { PayoutMethodsService } from './payout-methods.service';

@Controller('v1/payout-methods')
export class PayoutMethodsController {
  constructor(private readonly methods: PayoutMethodsService) {}

  @Get()
  async list(@CurrentDriverId() driverId: string) {
    return { items: await this.methods.list(driverId) };
  }

  @Post()
  async add(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(addPayoutMethodSchema)) dto: AddPayoutMethodDto,
  ) {
    return this.methods.add(driverId, dto);
  }

  @Post(':id/default')
  @HttpCode(204)
  async makeDefault(@CurrentDriverId() driverId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.methods.makeDefault(driverId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentDriverId() driverId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.methods.remove(driverId, id);
  }
}
