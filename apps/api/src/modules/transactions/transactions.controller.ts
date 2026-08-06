import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { TransactionHistoryQueryDto } from './dto/transaction-history-query.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get('me')
  myHistory(@CurrentUser() user: RequestUser, @Query() query: TransactionHistoryQueryDto) {
    return this.transactionsService.history({ ...query, userId: user.id });
  }
}
