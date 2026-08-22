import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/request-user.type';
import { RefundPaymentDto } from './dto/capture-payment.dto';
import { RefundEngineService } from './refund-engine.service';

/**
 * Refunds are an operator action, never the customer's own.
 *
 * A customer who could refund themselves has a withdraw button: buy, earn
 * the points, refund the purchase, keep whatever the clawback could not
 * reach. `PAYMENT_REFUND` is held by ADMIN and SUPER_ADMIN only.
 */
@ApiTags('refunds')
@ApiBearerAuth()
@Controller('refunds')
export class RefundsController {
  constructor(
    private readonly refunds: RefundEngineService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermissions(PermissionName.PAYMENT_REFUND)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refund(@CurrentUser() operator: RequestUser, @Body() dto: RefundPaymentDto) {
    const result = await this.refunds.refund({
      paymentId: dto.paymentId,
      amount: dto.amount,
      reason: dto.reason,
      actorId: operator.id,
      idempotencyKey: dto.idempotencyKey,
    });

    await this.audit.record({
      actorUserId: operator.id,
      action: AuditAction.PAYMENT_REFUNDED,
      entityType: 'Payment',
      entityId: dto.paymentId,
      metadata: {
        refundId: result.refundId,
        amount: result.amount,
        totalRefunded: result.totalRefunded,
        bonusClawedBack: result.bonusClawedBack,
        // PENDING here means the PSP has not yet confirmed the money moved —
        // see RefundEngineService's class docblock. The audit record must
        // not read as "money moved" until it actually has.
        pspStatus: result.pspStatus,
        reason: dto.reason,
      },
    });

    return result;
  }
}
