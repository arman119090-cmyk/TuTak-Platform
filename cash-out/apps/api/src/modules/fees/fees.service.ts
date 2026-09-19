import { Injectable } from '@nestjs/common';
import {
  FeeComponentConfig,
  FeeSchedule as FeeMath,
  Money,
  RoundingMode,
  ROUNDING_MODES,
  quoteFromGross,
  quoteForNet,
  WithdrawalQuote,
} from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';

export interface ResolvedFeeSchedule {
  readonly id: string;
  readonly math: FeeMath;
}

@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Finds the schedule in force for a park right now, falling back to the
   * default schedule.
   *
   * Pricing is resolved once, at quote time, and the resulting schedule id is
   * stored on the quote and on the withdrawal. A price change must never alter
   * what a driver was shown a minute earlier, and it never alters what is
   * already in the ledger.
   */
  async resolve(parkId: string | null, currency: string): Promise<ResolvedFeeSchedule> {
    const now = this.clock.now();
    const candidates = await this.prisma.feeSchedule.findMany({
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
      throw new AppError(
        'INTERNAL_ERROR',
        `No fee schedule is configured for ${currency}${parkId ? ` (park ${parkId})` : ''}`,
      );
    }

    return { id: chosen.id, math: toFeeMath(chosen) };
  }

  async quote(
    parkId: string | null,
    requested: Money,
  ): Promise<{ quote: WithdrawalQuote; feeScheduleId: string }> {
    const schedule = await this.resolve(parkId, requested.currency);
    return { quote: quoteFromGross(requested, schedule.math), feeScheduleId: schedule.id };
  }

  /**
   * "Withdraw everything": the largest gross the driver's balance supports.
   *
   * With `payoutIncrementMinor > 1` the largest workable gross can be slightly
   * below the balance, so this asks the fee engine rather than assuming the
   * whole balance is spendable.
   */
  async quoteAll(
    parkId: string | null,
    available: Money,
  ): Promise<{ quote: WithdrawalQuote; feeScheduleId: string } | null> {
    if (!available.isPositive) return null;
    const schedule = await this.resolve(parkId, available.currency);
    try {
      return { quote: quoteFromGross(available, schedule.math), feeScheduleId: schedule.id };
    } catch {
      return null;
    }
  }

  async quoteForDesiredNet(
    parkId: string | null,
    desiredNet: Money,
    maxGross: Money,
  ): Promise<{ quote: WithdrawalQuote; feeScheduleId: string } | null> {
    const schedule = await this.resolve(parkId, desiredNet.currency);
    const quote = quoteForNet(desiredNet, schedule.math, maxGross);
    return quote ? { quote, feeScheduleId: schedule.id } : null;
  }
}

interface FeeScheduleRow {
  platformRateNumerator: bigint;
  platformRateDenominator: bigint;
  platformFixedMinor: bigint;
  platformMinMinor: bigint | null;
  platformMaxMinor: bigint | null;
  platformRounding: string;
  providerRateNumerator: bigint;
  providerRateDenominator: bigint;
  providerFixedMinor: bigint;
  providerMinMinor: bigint | null;
  providerMaxMinor: bigint | null;
  providerRounding: string;
  payoutIncrementMinor: bigint;
}

export function toFeeMath(row: FeeScheduleRow): FeeMath {
  return {
    platform: component(
      row.platformRateNumerator,
      row.platformRateDenominator,
      row.platformFixedMinor,
      row.platformMinMinor,
      row.platformMaxMinor,
      row.platformRounding,
    ),
    provider: component(
      row.providerRateNumerator,
      row.providerRateDenominator,
      row.providerFixedMinor,
      row.providerMinMinor,
      row.providerMaxMinor,
      row.providerRounding,
    ),
    payoutIncrementMinor: row.payoutIncrementMinor,
  };
}

function component(
  numerator: bigint,
  denominator: bigint,
  fixed: bigint,
  min: bigint | null,
  max: bigint | null,
  rounding: string,
): FeeComponentConfig {
  return {
    rateNumerator: numerator,
    rateDenominator: denominator,
    fixedMinor: fixed,
    minMinor: min ?? undefined,
    maxMinor: max ?? undefined,
    rounding: toRoundingMode(rounding),
  };
}

export function toRoundingMode(value: string): RoundingMode {
  if ((ROUNDING_MODES as readonly string[]).includes(value)) {
    return value as RoundingMode;
  }
  throw new AppError('INTERNAL_ERROR', `Fee schedule has an unknown rounding mode "${value}"`);
}

export function moneyFrom(minor: bigint, currency: string): Money {
  return Money.fromMinor(minor, currency as CurrencyCode);
}
