import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PermissionName } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/request-user.type';
import { LedgerService } from '../ledger/ledger.service';
import { RunReconciliationDto } from './dto/run-reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

/**
 * The ledger's read surface and reconciliation controls.
 *
 * Everything here is platform-wide: `LEDGER_READ` exposes every account on
 * the platform, including every partner's balance, which is why it is a
 * permission of its own rather than something bundled with analytics.
 */
@ApiTags('admin/ledger')
@ApiBearerAuth()
@Controller('admin')
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('ledger/accounts')
  @RequirePermissions(PermissionName.LEDGER_READ)
  accounts() {
    return this.prisma.ledgerAccount.findMany({ orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] });
  }

  /**
   * An account's postings, with its replayed balance alongside the stored
   * one — the two disagreeing is the single most useful thing this endpoint
   * can show, so it is computed here rather than left to the caller.
   */
  @Get('ledger/accounts/:id/postings')
  @RequirePermissions(PermissionName.LEDGER_READ)
  async postings(@Param('id') id: string, @Query('limit') limit?: string) {
    const account = await this.prisma.ledgerAccount.findUniqueOrThrow({ where: { id } });
    const take = Math.min(Number(limit) || 100, 500);

    const [postings, replayed] = await Promise.all([
      this.prisma.ledgerPosting.findMany({
        where: { accountId: id },
        orderBy: { createdAt: 'desc' },
        take,
        include: { transaction: true },
      }),
      this.ledger.replayBalance(id),
    ]);

    return {
      account,
      storedBalance: account.balance.toFixed(4),
      replayedBalance: replayed.toFixed(4),
      inSync: account.balance.minus(replayed).abs().lessThan(new Decimal('0.0001')),
      postings,
    };
  }

  @Get('reconciliation')
  @RequirePermissions(PermissionName.LEDGER_READ)
  runs() {
    return this.reconciliation.listRuns();
  }

  /**
   * Runs reconciliation on demand, for a day whose statement has arrived out
   * of band. The nightly cron does the same thing without a statement.
   */
  @Post('reconciliation/run')
  @RequirePermissions(PermissionName.LEDGER_READ)
  async run(@CurrentUser() admin: RequestUser, @Body() dto: RunReconciliationDto) {
    const day = new Date(dto.periodStart);
    const periodStart = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
    );

    const result = await this.reconciliation.reconcile({
      periodStart,
      pspReceivable: dto.pspReceivable,
      platformBank: dto.platformBank,
      partnerPayables: dto.partnerPayables,
    });

    await this.audit.record({
      actorUserId: admin.id,
      action: AuditAction.RECONCILIATION_RUN,
      entityType: 'ReconciliationRun',
      entityId: result.runId,
      metadata: {
        periodStart: periodStart.toISOString(),
        status: result.status,
        findingCount: result.findings.length,
        partnersBlocked: result.partnersBlocked,
      },
    });

    return result;
  }

  /**
   * Clears a payout block after a human has resolved the discrepancy.
   *
   * Separate from `reconcile` on purpose: an engine that both raises and
   * clears its own blocks can talk itself out of a real problem.
   */
  @Post('partners/:partnerId/payout-block/clear')
  @RequirePermissions(PermissionName.PAYOUT_MANAGE)
  async clearBlock(@CurrentUser() admin: RequestUser, @Param('partnerId') partnerId: string) {
    await this.reconciliation.clearPayoutBlock(partnerId, admin.id);
    await this.audit.record({
      actorUserId: admin.id,
      action: AuditAction.PAYOUT_BLOCK_CLEARED,
      entityType: 'Partner',
      entityId: partnerId,
    });
    return { success: true };
  }
}
