import { Injectable } from '@nestjs/common';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ErrorCode } from '@cashout/contracts';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';

export interface LimitCheckInput {
  readonly driverId: string;
  readonly parkId: string | null;
  readonly gross: Money;
}

export type LimitDecision =
  | { readonly outcome: 'ALLOW' }
  | { readonly outcome: 'MANUAL_REVIEW'; readonly reason: string }
  | {
      readonly outcome: 'DENY';
      readonly code: ErrorCode;
      readonly message: string;
      readonly details?: Record<string, unknown>;
    };

export interface ResolvedLimits {
  readonly id: string;
  readonly min: Money;
  readonly max: Money;
  readonly dailyAmount: Money;
  readonly dailyCount: number;
  readonly weeklyAmount: Money;
  readonly monthlyAmount: Money;
  readonly velocityWindowSeconds: number;
  readonly velocityMaxCount: number;
  readonly manualReviewAbove: Money | null;
}

/**
 * Amount and velocity limits.
 *
 * Two design points worth stating:
 *
 *  - Usage is summed over withdrawals that **were or still could be paid**.
 *    A withdrawal that failed before anything moved does not consume a limit;
 *    one that is still in flight does, because it may yet succeed. Counting only
 *    completed withdrawals would let a driver queue up their daily limit several
 *    times over while the first batch is still processing.
 *  - The decision is a value, not an exception. "Too big" and "needs a human"
 *    are different outcomes, and the caller has to handle both explicitly.
 */
@Injectable()
export class LimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async resolve(parkId: string | null, currency: string): Promise<ResolvedLimits> {
    const now = this.clock.now();
    const candidates = await this.prisma.limitPolicy.findMany({
      where: {
        currency,
        effectiveFrom: { lte: now },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          // The park's own row if it has one, otherwise the default row.
          { OR: parkId ? [{ parkId }, { parkId: null }] : [{ parkId: null }] },
        ],
      },
      orderBy: [{ parkId: { sort: 'desc', nulls: 'last' } }, { effectiveFrom: 'desc' }],
      take: 2,
    });

    const chosen = candidates.find((item) => item.parkId === parkId) ?? candidates[0];
    if (!chosen) {
      throw new AppError('INTERNAL_ERROR', `No limit policy is configured for ${currency}`);
    }

    const money = (minor: bigint) => Money.fromMinor(minor, currency as CurrencyCode);
    return {
      id: chosen.id,
      min: money(chosen.minWithdrawalMinor),
      max: money(chosen.maxWithdrawalMinor),
      dailyAmount: money(chosen.dailyAmountMinor),
      dailyCount: chosen.dailyCountMax,
      weeklyAmount: money(chosen.weeklyAmountMinor),
      monthlyAmount: money(chosen.monthlyAmountMinor),
      velocityWindowSeconds: chosen.velocityWindowSeconds,
      velocityMaxCount: chosen.velocityMaxCount,
      manualReviewAbove: chosen.manualReviewAboveMinor
        ? money(chosen.manualReviewAboveMinor)
        : null,
    };
  }

  async check(input: LimitCheckInput, tx?: TransactionClient): Promise<LimitDecision> {
    const limits = await this.resolve(input.parkId, input.gross.currency);
    const client = tx ?? this.prisma;

    if (input.gross.lessThan(limits.min)) {
      return {
        outcome: 'DENY',
        code: 'AMOUNT_BELOW_MINIMUM',
        message: `The minimum withdrawal is ${limits.min.toString()}`,
        details: { minimum: limits.min.toJSON() },
      };
    }
    if (input.gross.greaterThan(limits.max)) {
      return {
        outcome: 'DENY',
        code: 'AMOUNT_ABOVE_MAXIMUM',
        message: `The maximum withdrawal is ${limits.max.toString()}`,
        details: { maximum: limits.max.toJSON() },
      };
    }

    const now = this.clock.now();
    const windows: Array<{
      since: Date;
      cap: Money;
      code: ErrorCode;
      label: string;
    }> = [
      {
        since: startOfDay(now),
        cap: limits.dailyAmount,
        code: 'DAILY_LIMIT_EXCEEDED',
        label: 'daily',
      },
      {
        since: minusDays(now, 7),
        cap: limits.weeklyAmount,
        code: 'WEEKLY_LIMIT_EXCEEDED',
        label: 'weekly',
      },
      {
        since: minusDays(now, 30),
        cap: limits.monthlyAmount,
        code: 'MONTHLY_LIMIT_EXCEEDED',
        label: 'monthly',
      },
    ];

    for (const window of windows) {
      const used = await this.usedSince(client, input.driverId, window.since, input.gross.currency);
      if (used.add(input.gross).greaterThan(window.cap)) {
        return {
          outcome: 'DENY',
          code: window.code,
          message: `This would exceed the ${window.label} limit of ${window.cap.toString()}`,
          details: { used: used.toJSON(), cap: window.cap.toJSON() },
        };
      }
    }

    const todayCount = await this.countSince(client, input.driverId, startOfDay(now));
    if (todayCount >= limits.dailyCount) {
      return {
        outcome: 'DENY',
        code: 'DAILY_LIMIT_EXCEEDED',
        message: `Only ${limits.dailyCount} withdrawals are allowed per day`,
        details: { used: todayCount, cap: limits.dailyCount },
      };
    }

    const velocityCount = await this.countSince(
      client,
      input.driverId,
      new Date(now.getTime() - limits.velocityWindowSeconds * 1000),
    );
    if (velocityCount >= limits.velocityMaxCount) {
      return {
        outcome: 'DENY',
        code: 'VELOCITY_LIMIT_EXCEEDED',
        message: `Only ${limits.velocityMaxCount} withdrawals are allowed per ${limits.velocityWindowSeconds} seconds`,
        details: { retryAfterSeconds: limits.velocityWindowSeconds },
      };
    }

    if (limits.manualReviewAbove && input.gross.greaterThan(limits.manualReviewAbove)) {
      return {
        outcome: 'MANUAL_REVIEW',
        reason: `Amount ${input.gross.toString()} is above the automatic-approval threshold ${limits.manualReviewAbove.toString()}`,
      };
    }

    return { outcome: 'ALLOW' };
  }

  /**
   * Everything that has been or may still be paid, since `since`. Withdrawals
   * that ended without money moving are excluded.
   */
  private async usedSince(
    client: PrismaService | TransactionClient,
    driverId: string,
    since: Date,
    currency: string,
  ): Promise<Money> {
    const result = await client.withdrawal.aggregate({
      where: {
        driverId,
        currency,
        createdAt: { gte: since },
        state: { notIn: ['FAILED', 'REJECTED', 'REVERSED'] },
      },
      _sum: { grossMinor: true },
    });
    return Money.fromMinor(result._sum.grossMinor ?? 0n, currency as CurrencyCode);
  }

  private async countSince(
    client: PrismaService | TransactionClient,
    driverId: string,
    since: Date,
  ): Promise<number> {
    return client.withdrawal.count({
      where: {
        driverId,
        createdAt: { gte: since },
        state: { notIn: ['FAILED', 'REJECTED', 'REVERSED'] },
      },
    });
  }
}

function startOfDay(now: Date): Date {
  const copy = new Date(now);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function minusDays(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
