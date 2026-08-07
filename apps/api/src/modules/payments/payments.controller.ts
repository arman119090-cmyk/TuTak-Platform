import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isPlatformAdmin } from '../../common/auth/partner-scope';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequestUser } from '../auth/types/request-user.type';
import { CapturePaymentDto } from './dto/capture-payment.dto';
import { PaymentEngineService } from './payment-engine.service';
import { RefundEngineService } from './refund-engine.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentEngineService,
    private readonly refunds: RefundEngineService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Charges the caller's own payment method.
   *
   * `userId` comes from the token and never from the body — letting a client
   * name the payer is how one account charges another's card.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  capture(@CurrentUser() user: RequestUser, @Body() dto: CapturePaymentDto) {
    return this.payments.capture({
      userId: user.id,
      partnerId: dto.partnerId,
      amount: dto.amount,
      sourceToken: dto.sourceToken,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.ownedPayment(user, id);
  }

  @Get(':id/refunds')
  async refundsFor(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.ownedPayment(user, id);
    return this.refunds.listForPayment(id);
  }

  /** A payment is readable by the customer who made it, and by platform admins. */
  private async ownedPayment(user: RequestUser, id: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    if (payment.userId !== user.id && !isPlatformAdmin(user)) {
      throw new ForbiddenException('This payment does not belong to you');
    }
    return payment;
  }
}
