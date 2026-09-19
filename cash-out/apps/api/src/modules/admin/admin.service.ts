import { Injectable } from '@nestjs/common';
import { WithdrawalState } from '@prisma/client';
import {
  AdminWithdrawalFilter,
  DashboardMetricsDto,
  ResolveManualReviewDto,
  hasOutstandingDebit,
} from '@cashout/contracts';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { WithdrawalOrchestrator } from '../withdrawals/withdrawal.orchestrator';
import { WithdrawalStateService } from '../withdrawals/withdrawal-state.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly states: WithdrawalStateService,
    private readonly orchestrator: WithdrawalOrchestrator,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  async dashboard(window: '24h' | '7d' | '30d', currency = 'AMD'): Promise<DashboardMetricsDto> {
    const hours = window === '24h' ? 24 : window === '7d' ? 168 : 720;
    const since = new Date(this.clock.nowMs() - hours * 3_600_000);

    const [total, volume, revenue, succeeded, inFlight, manualReview, suspense] = await Promise.all(
      [
        this.prisma.withdrawal.count({ where: { createdAt: { gte: since }, currency } }),
        this.prisma.withdrawal.aggregate({
          where: {
            createdAt: { gte: since },
            currency,
            state: { in: ['COMPLETED', 'PAYOUT_CONFIRMED'] },
          },
          _sum: { grossMinor: true },
        }),
        this.prisma.withdrawal.aggregate({
          where: {
            createdAt: { gte: since },
            currency,
            state: { in: ['COMPLETED', 'PAYOUT_CONFIRMED'] },
          },
          _sum: { platformFeeMinor: true },
        }),
        this.prisma.withdrawal.count({
          where: {
            createdAt: { gte: since },
            currency,
            state: { in: ['COMPLETED', 'PAYOUT_CONFIRMED'] },
          },
        }),
        this.prisma.withdrawal.count({
          where: { state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] } },
        }),
        this.prisma.withdrawal.count({
          where: { state: { in: ['MANUAL_REVIEW', 'RISK_REVIEW'] } },
        }),
        this.ledger.balanceOf('SUSPENSE', 'GLOBAL', currency),
      ],
    );

    const stuck = await this.stuckCount();
    const money = (minor: bigint) => Money.fromMinor(minor, currency as CurrencyCode).toJSON();

    return {
      window,
      withdrawalsCount: total,
      withdrawalsVolume: money(volume._sum.grossMinor ?? 0n),
      platformRevenue: money(revenue._sum.platformFeeMinor ?? 0n),
      // Parts per million rather than a float: a success rate is reported, not
      // computed with, and an integer cannot drift.
      successRatePpm: total === 0 ? 1_000_000 : Math.round((succeeded / total) * 1_000_000),
      inFlightCount: inFlight,
      manualReviewCount: manualReview,
      stuckCount: stuck,
      suspenseBalance: suspense.toJSON(),
    };
  }

  private async stuckCount(olderThanSeconds = 900): Promise<number> {
    const cutoff = new Date(this.clock.nowMs() - olderThanSeconds * 1000);
    const rows = await this.prisma.withdrawal.findMany({
      where: {
        updatedAt: { lt: cutoff },
        state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
      },
      select: { state: true },
      take: 500,
    });
    return rows.filter((row) => hasOutstandingDebit(row.state)).length;
  }

  async listWithdrawals(filter: AdminWithdrawalFilter) {
    const where = {
      ...(filter.state ? { state: filter.state as WithdrawalState } : {}),
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(filter.parkId ? { parkId: filter.parkId } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
      ...(filter.needsAttention
        ? {
            state: {
              in: [
                'MANUAL_REVIEW',
                'RISK_REVIEW',
                'RESERVE_UNCERTAIN',
                'PAYOUT_UNCERTAIN',
                'PAYOUT_FAILED',
                'PAYOUT_RETURNED',
                'COMPENSATING',
              ] as WithdrawalState[],
            },
          }
        : {}),
    };

    const rows = await this.prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: { driver: { include: { user: true } }, payoutMethod: true },
    });

    const page = rows.slice(0, filter.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        reference: row.reference,
        state: row.state,
        currency: row.currency,
        gross: row.grossMinor.toString(),
        net: row.netMinor.toString(),
        platformFee: row.platformFeeMinor.toString(),
        providerFee: row.providerFeeMinor.toString(),
        driverId: row.driverId,
        driverPhone: row.driver.user.phone,
        driverName: [row.driver.firstName, row.driver.lastName].filter(Boolean).join(' ') || null,
        parkId: row.parkId,
        payoutMethod: row.payoutMethod.maskedIdentifier,
        failureCode: row.failureCode,
        manualReviewReason: row.manualReviewReason,
        riskScore: row.riskScore,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > filter.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async withdrawalDetail(id: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id },
      include: {
        driver: { include: { user: true } },
        payoutMethod: true,
        events: { orderBy: { at: 'asc' } },
        providerEvents: { orderBy: { receivedAt: 'asc' } },
      },
    });
    if (!withdrawal) throw AppError.notFound('Withdrawal');

    const entries = await this.ledger.entriesForWithdrawal(id);

    return {
      withdrawal: {
        id: withdrawal.id,
        reference: withdrawal.reference,
        state: withdrawal.state,
        currency: withdrawal.currency,
        gross: withdrawal.grossMinor.toString(),
        platformFee: withdrawal.platformFeeMinor.toString(),
        providerFee: withdrawal.providerFeeMinor.toString(),
        net: withdrawal.netMinor.toString(),
        parkId: withdrawal.parkId,
        yandexContractorProfileId: withdrawal.yandexContractorProfileId,
        yandexTransactionId: withdrawal.yandexTransactionId,
        yandexBalanceBefore: withdrawal.yandexBalanceBeforeMinor?.toString() ?? null,
        yandexBalanceAfter: withdrawal.yandexBalanceAfterMinor?.toString() ?? null,
        providerTransactionId: withdrawal.providerTransactionId,
        failureCode: withdrawal.failureCode,
        failureMessage: withdrawal.failureMessage,
        manualReviewReason: withdrawal.manualReviewReason,
        riskScore: withdrawal.riskScore,
        attempts: withdrawal.attempts,
        createdAt: withdrawal.createdAt.toISOString(),
        updatedAt: withdrawal.updatedAt.toISOString(),
      },
      driver: {
        id: withdrawal.driver.id,
        phone: withdrawal.driver.user.phone,
        name: [withdrawal.driver.firstName, withdrawal.driver.lastName].filter(Boolean).join(' '),
        verificationStatus: withdrawal.driver.verificationStatus,
      },
      payoutMethod: {
        id: withdrawal.payoutMethod.id,
        masked: withdrawal.payoutMethod.maskedIdentifier,
        status: withdrawal.payoutMethod.status,
      },
      timeline: withdrawal.events.map((event) => ({
        from: event.fromState,
        to: event.toState,
        at: event.at.toISOString(),
        actorType: event.actorType,
        note: event.note,
      })),
      providerEvents: withdrawal.providerEvents.map((event) => ({
        id: event.id,
        type: event.type,
        receivedAt: event.receivedAt.toISOString(),
        processedAt: event.processedAt?.toISOString() ?? null,
      })),
      ledger: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        description: entry.description,
        createdAt: entry.createdAt.toISOString(),
        postings: entry.postings.map((posting) => ({
          account: `${posting.account.type}:${posting.account.key}`,
          direction: posting.direction,
          amount: posting.amountMinor.toString(),
          currency: posting.currency,
        })),
      })),
    };
  }

  /**
   * An operator's decision about a withdrawal that automation could not finish.
   *
   * Every branch demands a written reason and records it. `MARK_COMPLETED` is
   * the dangerous one — it asserts that money really did reach the driver — so
   * it insists on an evidence reference, which in practice is the bank's
   * transaction id from the provider's own dashboard.
   */
  async resolveManualReview(
    withdrawalId: string,
    adminId: string,
    dto: ResolveManualReviewDto,
  ): Promise<void> {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw AppError.notFound('Withdrawal');
    if (withdrawal.state !== 'MANUAL_REVIEW' && withdrawal.state !== 'RISK_REVIEW') {
      throw new AppError(
        'VALIDATION_FAILED',
        `This withdrawal is ${withdrawal.state}, not under review`,
      );
    }

    if (dto.resolution === 'MARK_COMPLETED' && !dto.evidenceReference) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Marking a payout completed requires the provider transaction id as evidence',
      );
    }

    const before = { state: withdrawal.state };

    switch (dto.resolution) {
      case 'MARK_COMPLETED':
        await this.prisma.inSerializableTransaction(async (tx) => {
          await this.states.transition(tx, withdrawal, 'COMPLETED', {
            note: dto.reason,
            actorType: 'ADMIN',
            actorId: adminId,
            data: {
              providerTransactionId: dto.evidenceReference ?? withdrawal.providerTransactionId,
            },
          });
        });
        break;

      case 'COMPENSATE':
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'COMPENSATING', {
            note: dto.reason,
            actorType: 'ADMIN',
            actorId: adminId,
            data: { attempts: 0, nextAttemptAt: null },
          }),
        );
        this.orchestrator.kick(withdrawalId);
        break;

      case 'MARK_FAILED':
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'FAILED', {
            note: dto.reason,
            actorType: 'ADMIN',
            actorId: adminId,
            data: { failureCode: 'admin_marked_failed' },
          }),
        );
        break;

      case 'RETRY_PAYOUT':
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'PAYOUT_SUBMITTING', {
            note: dto.reason,
            actorType: 'ADMIN',
            actorId: adminId,
            data: { attempts: 0, nextAttemptAt: null },
          }),
        );
        this.orchestrator.kick(withdrawalId);
        break;
    }

    await this.audit.record({
      action: `withdrawal.manual_review.${dto.resolution.toLowerCase()}`,
      subjectType: 'withdrawal',
      subjectId: withdrawalId,
      actorType: 'ADMIN',
      actorId: adminId,
      reason: dto.reason,
      before,
      after: { resolution: dto.resolution, evidence: dto.evidenceReference ?? null },
    });

    this.logger.warning('Manual review resolved', {
      withdrawalId,
      adminId,
      resolution: dto.resolution,
    });
  }

  async listDrivers(query: { limit: number; cursor?: string; search?: string }) {
    const rows = await this.prisma.driver.findMany({
      where: query.search
        ? {
            OR: [
              { user: { phone: { contains: query.search } } },
              { yandexContractorProfileId: { contains: query.search } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {},
      include: { user: true, _count: { select: { withdrawals: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        phone: row.user.phone,
        name: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
        verificationStatus: row.verificationStatus,
        parkId: row.parkId,
        yandexContractorProfileId: row.yandexContractorProfileId,
        riskTier: row.riskTier,
        withdrawalCount: row._count.withdrawals,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async driverDetail(driverId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        user: true,
        payoutMethods: { orderBy: { createdAt: 'desc' } },
        withdrawals: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!driver) throw AppError.notFound('Driver');

    const currency = driver.currency ?? 'AMD';
    const payable = await this.ledger.balanceOf('DRIVER_PAYABLE', driver.id, currency);

    return {
      driver: {
        id: driver.id,
        phone: driver.user.phone,
        name: [driver.firstName, driver.lastName].filter(Boolean).join(' ') || null,
        locale: driver.user.locale,
        verificationStatus: driver.verificationStatus,
        parkId: driver.parkId,
        yandexContractorProfileId: driver.yandexContractorProfileId,
        currency,
        riskTier: driver.riskTier,
        blockReason: driver.blockReason,
        verifiedAt: driver.verifiedAt?.toISOString() ?? null,
        createdAt: driver.createdAt.toISOString(),
      },
      /** What Cash Out still owes this driver, straight from the ledger. */
      outstandingPayable: payable.toJSON(),
      payoutMethods: driver.payoutMethods.map((method) => ({
        id: method.id,
        kind: method.kind,
        status: method.status,
        masked: method.maskedIdentifier,
        displayName: method.displayName,
        isDefault: method.isDefault,
        createdAt: method.createdAt.toISOString(),
        disabledAt: method.disabledAt?.toISOString() ?? null,
      })),
      withdrawals: driver.withdrawals.map((row) => ({
        id: row.id,
        reference: row.reference,
        state: row.state,
        currency: row.currency,
        gross: row.grossMinor.toString(),
        net: row.netMinor.toString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async setDriverBlocked(driverId: string, blocked: boolean, adminId: string, reason: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw AppError.notFound('Driver');

    await this.prisma.driver.update({
      where: { id: driverId },
      data: {
        verificationStatus: blocked
          ? 'BLOCKED'
          : driver.yandexContractorProfileId
            ? 'VERIFIED'
            : 'UNLINKED',
        blockedAt: blocked ? this.clock.now() : null,
        blockReason: blocked ? reason : null,
      },
    });

    await this.audit.record({
      action: blocked ? 'driver.blocked' : 'driver.unblocked',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'ADMIN',
      actorId: adminId,
      reason,
      before: { verificationStatus: driver.verificationStatus },
    });
  }

  async auditLog(query: { limit: number; cursor?: string; subjectId?: string }) {
    const rows = await this.prisma.auditLog.findMany({
      where: query.subjectId ? { subjectId: query.subjectId } : {},
      orderBy: { at: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        reason: row.reason,
        requestId: row.requestId,
      })),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
