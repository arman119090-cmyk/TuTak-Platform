import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  confirmWithdrawalSchema,
  createQuoteSchema,
  paginationSchema,
  type ConfirmWithdrawalDto,
  type CreateQuoteDto,
} from '@cashout/contracts';
import { zodBody, ZodValidationPipe } from '../../common/zod.pipe';
import { CurrentDriverId } from '../auth/auth.decorators';
import { QuoteService } from './quote.service';
import { WithdrawalsService } from './withdrawals.service';

@Controller('v1/withdrawals')
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly quotes: QuoteService,
  ) {}

  /** Step one of the payout flow: what would this cost? */
  @Post('quote')
  async quote(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(createQuoteSchema)) dto: CreateQuoteDto,
  ) {
    return this.quotes.create(driverId, dto);
  }

  /** Step two: do it. Idempotent on the client-supplied key. */
  @Post()
  async confirm(
    @CurrentDriverId() driverId: string,
    @Body(zodBody(confirmWithdrawalSchema)) dto: ConfirmWithdrawalDto,
  ) {
    return this.withdrawals.confirm(driverId, dto);
  }

  @Get()
  async list(
    @CurrentDriverId() driverId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: { limit: number; cursor?: string },
  ) {
    return this.withdrawals.list(driverId, query.limit, query.cursor);
  }

  @Get(':id')
  async get(@CurrentDriverId() driverId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.get(driverId, id);
  }

  @Get(':id/timeline')
  async timeline(@CurrentDriverId() driverId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.withdrawals.timeline(driverId, id) };
  }
}
