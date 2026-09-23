import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName, ReconciliationOutcome } from '@prisma/client';
import { assertPartnerScope } from '../../common/auth/partner-scope';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import {
  CancelSettlementDto,
  CreateSettlementDraftDto,
  MarkReadyDto,
  PartnerActivityQueryDto,
  ProposeSettlementReconciliationDto,
  RecordTransferDto,
  ReportTransferProblemDto,
  TransferFailedDto,
} from './dto/settlement.dto';
import { PartnerSettlementService } from './partner-settlement.service';

/**
 * Finance's view of what the platform owes its partners.
 *
 * The engine underneath is unchanged — this only exposes it. Every actor is
 * the authenticated caller, and the two-person steps are two requests: the
 * maker/checker rule is not something a single caller can satisfy by
 * supplying two names.
 */
@ApiTags('partner-settlements')
@ApiBearerAuth()
@Controller('admin/partner-settlements')
export class PartnerSettlementAdminController {
  constructor(private readonly settlements: PartnerSettlementService) {}

  /** What a partner is owed but has not been settled for. Reads postings. */
  @Get('unsettled/:partnerId')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async unsettled(@UuidParam('partnerId') partnerId: string) {
    return this.settlements.unsettled(partnerId);
  }

  @Get()
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async list(@Query('partnerId') partnerId?: string) {
    return this.settlements.list({ partnerId });
  }

  @Get(':id')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async detail(@UuidParam('id') id: string) {
    return this.settlements.detail(id);
  }

  @Post('drafts/:partnerId')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async draft(
    @CurrentUser() actor: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @Body() dto: CreateSettlementDraftDto,
  ) {
    return this.settlements.createDraft({
      partnerId,
      actorId: actor.id,
      periodStart: new Date(dto.periodStart),
      periodEnd: new Date(dto.periodEnd),
    });
  }

  @Post(':id/ready')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async ready(
    @CurrentUser() actor: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: MarkReadyDto,
  ) {
    return this.settlements.markReady(id, {
      actorId: actor.id,
      documentNumber: dto.documentNumber,
      documentDate: dto.documentDate ? new Date(dto.documentDate) : undefined,
      documentReference: dto.documentReference,
    });
  }

  /** The checker. The service refuses the settlement's own creator. */
  @Post(':id/approve')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async approve(@CurrentUser() actor: RequestUser, @UuidParam('id') id: string) {
    return this.settlements.approve(id, actor.id);
  }

  @Post(':id/payment-pending')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async paymentPending(@CurrentUser() actor: RequestUser, @UuidParam('id') id: string) {
    return this.settlements.markPaymentPending(id, actor.id);
  }

  /**
   * The bank confirmed it. The only step that posts to the ledger.
   *
   * Takes a bank reference and nothing else: "paid" without a reference is a
   * claim that money moved with nothing backing it, and the database refuses
   * that shape anyway.
   */
  @Post(':id/paid')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async paid(
    @CurrentUser() actor: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: RecordTransferDto,
  ) {
    return this.settlements.markPaid(id, {
      actorId: actor.id,
      bankTransferReference: dto.bankTransferReference,
    });
  }

  /** The bank refused it and we know no money left. Still retryable. */
  @Post(':id/failed')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async failed(
    @CurrentUser() actor: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: TransferFailedDto,
  ) {
    return this.settlements.markFailed(id, {
      actorId: actor.id,
      reason: dto.reason,
      bankTransferReference: dto.bankTransferReference,
    });
  }

  /** The bank's answer is ambiguous. Never retried automatically. */
  @Post(':id/requires-reconciliation')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async ambiguous(
    @CurrentUser() actor: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: TransferFailedDto,
  ) {
    return this.settlements.markRequiresReconciliation(id, {
      actorId: actor.id,
      reason: dto.reason,
      bankTransferReference: dto.bankTransferReference,
    });
  }

  @Post(':id/reconciliation/propose')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async proposeReconciliation(
    @CurrentUser() actor: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: ProposeSettlementReconciliationDto,
  ) {
    return this.settlements.proposeReconciliationOutcome(id, {
      actorId: actor.id,
      outcome: dto.outcome,
      evidence: dto.evidence,
      bankTransferReference:
        dto.outcome === ReconciliationOutcome.MONEY_MOVED ? dto.bankTransferReference : undefined,
    });
  }

  /** The second pair of eyes, and the act that finally moves it. */
  @Post(':id/reconciliation/confirm')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async confirmReconciliation(@CurrentUser() actor: RequestUser, @UuidParam('id') id: string) {
    return this.settlements.confirmReconciliationOutcome(id, { actorId: actor.id });
  }

  @Post(':id/cancel')
  @RequirePermissions(PermissionName.SETTLEMENT_MANAGE)
  async cancel(
    @CurrentUser() actor: RequestUser,
    @UuidParam('id') id: string,
    @Body() dto: CancelSettlementDto,
  ) {
    return this.settlements.cancel(id, { actorId: actor.id, reason: dto.reason });
  }
}

/**
 * What a partner may see and do about their own money.
 *
 * Read everything, change nothing. A partner disputing a figure needs the
 * itemisation down to the purchase that produced it — that is what makes the
 * statement answerable rather than a number to be argued with. What they
 * cannot do is move their own Net Position: they are the payee, and a payee
 * who can adjust what they are owed is not a payee.
 *
 * The one write they have is reporting a problem, which asserts nothing
 * about whether money moved and locks them out of deciding it.
 *
 * Every read here demands `SETTLEMENT_READ` as well as partner scope, and
 * the two are not interchangeable. Scope asks *which* partner and nothing
 * else, so a cashier — scoped to their own partner like everybody else on
 * its payroll — passed it. `ROLE_PERMISSIONS` grants `SETTLEMENT_READ` to
 * `PARTNER_OWNER` alone and says why in its own docblock; these routes
 * simply never asked for it, so the organisation's whole money position and
 * every itemised statement were readable by anyone who could confirm a sale.
 * `partner-settlement-access.int-spec.ts` pins both halves.
 */
@ApiTags('partner-settlements')
@ApiBearerAuth()
@Controller('partner/settlements')
export class PartnerSettlementPartnerController {
  constructor(private readonly settlements: PartnerSettlementService) {}

  @Get(':partnerId')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async statements(@CurrentUser() actor: RequestUser, @UuidParam('partnerId') partnerId: string) {
    assertPartnerScope(actor, partnerId);
    return this.settlements.list({ partnerId });
  }

  /** Opening, movements and closing, itemised to the source of each line. */
  @Get(':partnerId/statement/:id')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async statement(
    @CurrentUser() actor: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @UuidParam('id') id: string,
  ) {
    assertPartnerScope(actor, partnerId);
    return this.settlements.partnerStatement(id, partnerId);
  }

  /**
   * The partner's money position: what is not yet in a settlement, what is
   * held in unpaid settlements, what is under review, what was paid, and the
   * ledger total that ties them together. `unsettled` alone read as zero the
   * moment a draft was created, which told a partner they had been paid.
   */
  @Get(':partnerId/position')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async position(@CurrentUser() actor: RequestUser, @UuidParam('partnerId') partnerId: string) {
    assertPartnerScope(actor, partnerId);
    return this.settlements.position(partnerId);
  }

  /**
   * One purchase, and what it did to the debt.
   *
   * The same permission as the rest of the money reads: this itemises a
   * financial position, and "which of my sales made up this figure" is the
   * same question as "how much do you owe me", asked about one line.
   */
  @Get(':partnerId/purchases/:purchaseIntentId/breakdown')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async purchaseBreakdown(
    @CurrentUser() actor: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @UuidParam('purchaseIntentId') purchaseIntentId: string,
  ) {
    assertPartnerScope(actor, partnerId);
    return this.settlements.purchaseBreakdown(partnerId, purchaseIntentId);
  }

  /**
   * Everything that moved this partner's debt, filtered and paged.
   *
   * Same permission as the position it itemises: this *is* the position,
   * line by line, and a reader who may not see the total may not see its
   * parts either.
   */
  @Get(':partnerId/activity')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async activity(
    @CurrentUser() actor: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @Query() query: PartnerActivityQueryDto,
  ) {
    assertPartnerScope(actor, partnerId);
    return this.settlements.activity(partnerId, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      branchId: query.branchId,
      state: query.state,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * "The money you say you sent never arrived."
   *
   * Gated on `SETTLEMENT_READ`, which is the owner's and not a manager's or
   * a cashier's. That is a narrowing, not a widening: the route used to
   * carry no permission at all, so anyone scoped to the partner could file
   * one, and filing one used to change the settlement's status. Only
   * somebody who can see the settlement can know a transfer is missing, and
   * only they should be able to say so.
   *
   * The report asserts nothing about whether money moved and changes
   * nothing that decides it — see `reportTransferProblem` for what it does
   * and what it stopped doing.
   */
  @Post(':partnerId/statement/:id/report-problem')
  @RequirePermissions(PermissionName.SETTLEMENT_READ)
  async reportProblem(
    @CurrentUser() actor: RequestUser,
    @UuidParam('partnerId') partnerId: string,
    @UuidParam('id') id: string,
    @Body() dto: ReportTransferProblemDto,
  ) {
    assertPartnerScope(actor, partnerId);
    return this.settlements.reportTransferProblem(id, {
      partnerUserId: actor.id,
      partnerId,
      reason: dto.reason,
    });
  }
}
