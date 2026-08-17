import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
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
    return this.qrPaymentsService.issue(dto, user);
  }

  /**
   * Ordinary customer purchases settle exclusively through PurchaseIntent
   * now — gross amount × the partner's negotiated contribution rate into
   * the canonical pool (20% GREEN / 30% deferred / 20% referral / rest
   * TuTak), with partner/cashier confirmation for non-integrated partners
   * (GitHub issue #28). `QrPaymentsService.redeem()` still contains the
   * older, independent settlement it always did — paid portion × the
   * partner's flat accrual rate, one immediate `ACCRUAL_PURCHASE`, no
   * pool split, no confirmation — kept, not deleted, because the existing
   * integration suite still exercises it directly as a lower-level unit
   * test of that engine (self-dealing, concurrency, crash-recovery,
   * money-rounding and others all predate PurchaseIntent and use it as
   * their money-moving fixture). What changes here is reachability: no
   * live UI calls this endpoint any more (`docs/HARDENING_AUDIT_2026-08-16.md`,
   * `docs/LAUNCH_READINESS_2026-08-16.md` both confirm it), so nothing
   * legitimate is lost by refusing it — and refusing it here, at the HTTP
   * boundary, is what stops a direct authenticated call to `POST
   * /qr/redeem` from settling a purchase through the old formula instead
   * of PurchaseIntent's.
   */
  @Post('redeem')
  redeem(@CurrentUser() _user: RequestUser, @Body() _dto: RedeemQrDto): never {
    throw new BadRequestException(
      'QR codes no longer settle a purchase directly. Ask the customer to open a purchase for ' +
        'this business — the amount is entered there and a cashier can only confirm or reject it.',
    );
  }
}
