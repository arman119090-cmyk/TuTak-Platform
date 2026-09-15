import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { ProposeReconciliationDto } from './dto/propose-reconciliation.dto';
import { PspCallbackInboxService } from './psp-callback-inbox.service';
import { PspPaymentService } from './psp-payment.service';

/**
 * Starting a payment and asking what became of it.
 *
 * Everything here takes its actor from the authenticated request. Nothing
 * accepts a user id in a body as proof of who is asking — a financial action
 * whose actor is a request field is a financial action anybody can attribute
 * to anybody.
 */
@ApiTags('psp')
@ApiBearerAuth()
@Controller('psp')
export class PspController {
  constructor(private readonly payments: PspPaymentService) {}

  /**
   * Open a bill for the customer's own purchase.
   *
   * No permission beyond being signed in, and the ownership check is in the
   * service rather than here, so another route reaching the same method
   * cannot bypass it. The service also refuses a purchase the business has
   * not approved — a provider confirms that money moved, not that a sale
   * happened.
   */
  @Post('purchases/:id/begin')
  async begin(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return this.payments.beginAttempt({ purchaseIntentId: id, customerId: customer.id });
  }

  /**
   * What the customer's app may believe about their payment.
   *
   * The app polls this after handing off to the provider. It must never show
   * success because the browser came back to a success URL: that proves a
   * redirect was followed and nothing about money.
   */
  @Get('purchases/:id/status')
  async status(@CurrentUser() customer: RequestUser, @UuidParam('id') id: string) {
    return this.payments.customerPaymentStatus(id, customer.id);
  }
}

/**
 * The finance queue: payments nobody can account for, and the two-person act
 * that releases one.
 *
 * `PSP_RECONCILE` gates both halves, and the halves are separate requests on
 * purpose. One caller cannot supply the second person's identity — that was
 * the previous shape and it is not dual control, it is dual control's
 * paperwork.
 */
@ApiTags('psp')
@ApiBearerAuth()
@Controller('admin/psp')
export class PspAdminController {
  constructor(
    private readonly payments: PspPaymentService,
    private readonly inbox: PspCallbackInboxService,
  ) {}

  /** Everything unresolved, oldest first — the queue somebody works through. */
  @Get('attempts/unresolved')
  @RequirePermissions(PermissionName.PSP_READ)
  async unresolved() {
    return this.payments.unresolvedAttempts();
  }

  /** Callbacks that gave up. Each one is a customer who may have paid. */
  @Get('callbacks/dead-lettered')
  @RequirePermissions(PermissionName.PSP_READ)
  async deadLettered() {
    return this.inbox.deadLettered();
  }

  /**
   * "I have read the provider's record and it shows no payment."
   *
   * Persists the reading and moves nothing. The actor is the authenticated
   * user; there is no field for it in the body, deliberately.
   */
  @Post('attempts/:id/reconciliation/propose')
  @RequirePermissions(PermissionName.PSP_RECONCILE)
  async propose(
    @CurrentUser() actor: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: ProposeReconciliationDto,
  ) {
    return this.payments.proposeManualReconciliation({
      attemptId: id,
      actorId: actor.id,
      evidence: dto.evidence,
    });
  }

  /**
   * A second person agrees, and the payment is released.
   *
   * The service refuses when this actor is the proposer, and the database
   * refuses it again. No body: there is nothing to say here that the
   * proposal did not already say, and a free-text field would invite
   * somebody to put a name in it.
   */
  @Post('attempts/:id/reconciliation/confirm')
  @RequirePermissions(PermissionName.PSP_RECONCILE)
  async confirm(@CurrentUser() actor: RequestUser, @UuidParam('id') id: string) {
    return this.payments.confirmManualReconciliation({ attemptId: id, actorId: actor.id });
  }
}
