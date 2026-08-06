import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { ReferralService } from './referral.service';

@ApiTags('referral')
@ApiBearerAuth()
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('me/code')
  getMyCode(@CurrentUser() user: RequestUser) {
    return this.referralService.getMyCode(user.id);
  }

  @Get('me/invites')
  listMyInvites(@CurrentUser() user: RequestUser) {
    return this.referralService.listMyInvites(user.id);
  }
}
