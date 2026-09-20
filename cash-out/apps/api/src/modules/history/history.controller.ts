import { Controller, Get, Param, Query } from '@nestjs/common';
import { historyFilterSchema, type HistoryFilter } from '@cashout/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CurrentDriverId } from '../auth/auth.decorators';
import { HistoryService } from './history.service';

@Controller('v1/history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  /** Balance history: filter by period, type and status; cursor-paginated. */
  @Get()
  async list(
    @CurrentDriverId() driverId: string,
    @Query(new ZodValidationPipe(historyFilterSchema)) filter: HistoryFilter,
  ) {
    return this.history.list(driverId, filter);
  }

  /** One operation, with the withdrawal, its timeline and/or its postings. */
  @Get(':id')
  async detail(@CurrentDriverId() driverId: string, @Param('id') id: string) {
    return this.history.detail(driverId, id);
  }
}
