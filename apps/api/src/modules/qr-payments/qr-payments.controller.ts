import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { IssueQrDto } from './dto/issue-qr.dto';
import { RedeemQrDto } from './dto/redeem-qr.dto';
import { QrPaymentsService } from './qr-payments.service';

@ApiTags('qr-payments')
@ApiBearerAuth()
@Controller('qr')
export class QrPaymentsController {
  constructor(private readonly qrPaymentsService: QrPaymentsService) {}

  @Post('issue')
  issue(@CurrentUser() user: RequestUser, @Body() dto: IssueQrDto) {
    return this.qrPaymentsService.issue(dto, user.id);
  }

  @Post('redeem')
  redeem(@CurrentUser() user: RequestUser, @Body() dto: RedeemQrDto) {
    return this.qrPaymentsService.redeem(dto, user.id);
  }
}
