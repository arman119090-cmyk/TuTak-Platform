import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { isPlatformAdmin } from '../../common/auth/partner-scope';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequestUser } from '../auth/types/request-user.type';
import { CapturePaymentDto, SearchPaymentsDto } from './dto/capture-payment.dto';
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

  /**
   * Recent payments, for an operator about to issue a refund.
   *
   * Declared before `:id` on purpose — Nest matches in declaration order, and
   * `@Get(':id')` above this would swallow `/payments/search` as a lookup for
   * a payment whose id is the literal string "search".
   *
   * Gated on PAYMENT_REFUND rather than a separate read permission: finding
   * the payment is strictly less privileged than refunding it, and anyone
   * who can do the latter needs the former to be useful.
   */
  @Get('search')
  @RequirePermissions(PermissionName.PAYMENT_REFUND)
  search(@Query() query: SearchPaymentsDto) {
    return this.prisma.payment.findMany({
      where: {
        ...(query.partnerId ? { partnerId: query.partnerId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(query.limit) || 50, 200),
      include: {
        partner: { select: { displayName: true } },
        user: { select: { firstName: true, lastName: true, phone: true } },
      },
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
