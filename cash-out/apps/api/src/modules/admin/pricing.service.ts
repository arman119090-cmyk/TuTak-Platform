import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { assertValidFeeConfig, ROUNDING_MODES } from '@cashout/money';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toFeeMath } from '../fees/fees.service';

const minorString = z.string().regex(/^\d+$/, 'must be a non-negative integer string');

/**
 * Changing pricing and limits.
 *
 * A change never edits the row in force. It closes the current row with an
 * `effectiveTo` and inserts a new one, in one transaction: history is preserved,
 * and "what was this driver charged in March" stays answerable. The partial
 * unique index in the schema guarantees there is never more than one open row
 * per park and currency, so "which fee applies" has exactly one answer.
 */
@Injectable()
export class PricingService {
  static readonly feeScheduleSchema = z.object({
    parkId: z.string().max(64).nullable().default(null),
    currency: z.enum(['AMD', 'RUB', 'USD', 'EUR', 'GEL', 'KZT']),
    platformRateNumerator: minorString,
    platformRateDenominator: z.string().regex(/^[1-9]\d*$/),
    platformFixedMinor: minorString,
    platformMinMinor: minorString.nullable().default(null),
    platformMaxMinor: minorString.nullable().default(null),
    platformRounding: z.enum(ROUNDING_MODES).default('HALF_UP'),
    providerRateNumerator: minorString,
    providerRateDenominator: z.string().regex(/^[1-9]\d*$/),
    providerFixedMinor: minorString,
    providerMinMinor: minorString.nullable().default(null),
    providerMaxMinor: minorString.nullable().default(null),
    providerRounding: z.enum(ROUNDING_MODES).default('HALF_UP'),
    payoutIncrementMinor: z.string().regex(/^[1-9]\d*$/).default('1'),
    reason: z.string().min(5).max(500),
  });

  static readonly limitPolicySchema = z.object({
    parkId: z.string().max(64).nullable().default(null),
    currency: z.enum(['AMD', 'RUB', 'USD', 'EUR', 'GEL', 'KZT']),
    minWithdrawalMinor: minorString,
    maxWithdrawalMinor: minorString,
    dailyAmountMinor: minorString,
    dailyCountMax: z.number().int().min(1).max(100),
    weeklyAmountMinor: minorString,
    monthlyAmountMinor: minorString,
    velocityWindowSeconds: z.number().int().min(60).max(86_400).default(3600),
    velocityMaxCount: z.number().int().min(1).max(50).default(3),
    manualReviewAboveMinor: minorString.nullable().default(null),
    reason: z.string().min(5).max(500),
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async listFeeSchedules() {
    const rows = await this.prisma.feeSchedule.findMany({
      orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      parkId: row.parkId,
      currency: row.currency,
      platformRate: `${row.platformRateNumerator}/${row.platformRateDenominator}`,
      platformFixedMinor: row.platformFixedMinor.toString(),
      providerRate: `${row.providerRateNumerator}/${row.providerRateDenominator}`,
      providerFixedMinor: row.providerFixedMinor.toString(),
      payoutIncrementMinor: row.payoutIncrementMinor.toString(),
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      active: row.effectiveTo === null,
    }));
  }

  async replaceFeeSchedule(
    dto: z.infer<typeof PricingService.feeScheduleSchema>,
    adminId: string,
  ) {
    const draft = {
      platformRateNumerator: BigInt(dto.platformRateNumerator),
      platformRateDenominator: BigInt(dto.platformRateDenominator),
      platformFixedMinor: BigInt(dto.platformFixedMinor),
      platformMinMinor: dto.platformMinMinor === null ? null : BigInt(dto.platformMinMinor),
      platformMaxMinor: dto.platformMaxMinor === null ? null : BigInt(dto.platformMaxMinor),
      platformRounding: dto.platformRounding,
      providerRateNumerator: BigInt(dto.providerRateNumerator),
      providerRateDenominator: BigInt(dto.providerRateDenominator),
      providerFixedMinor: BigInt(dto.providerFixedMinor),
      providerMinMinor: dto.providerMinMinor === null ? null : BigInt(dto.providerMinMinor),
      providerMaxMinor: dto.providerMaxMinor === null ? null : BigInt(dto.providerMaxMinor),
      providerRounding: dto.providerRounding,
      payoutIncrementMinor: BigInt(dto.payoutIncrementMinor),
    };

    // Reject an unusable schedule before it can be the one in force.
    const math = toFeeMath(draft);
    assertValidFeeConfig(math.platform, 'platform fee');
    assertValidFeeConfig(math.provider, 'provider fee');

    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.feeSchedule.findFirst({
        where: { parkId: dto.parkId, currency: dto.currency, effectiveTo: null },
      });
      if (previous) {
        await tx.feeSchedule.update({ where: { id: previous.id }, data: { effectiveTo: now } });
      }
      const created = await tx.feeSchedule.create({
        data: {
          parkId: dto.parkId,
          currency: dto.currency,
          ...draft,
          effectiveFrom: now,
          createdByAdminId: adminId,
        },
      });

      await this.audit.record(
        {
          action: 'fees.changed',
          subjectType: 'fee_schedule',
          subjectId: created.id,
          actorType: 'ADMIN',
          actorId: adminId,
          reason: dto.reason,
          before: previous ? { id: previous.id } : undefined,
          after: { parkId: dto.parkId, currency: dto.currency },
        },
        tx,
      );

      return { id: created.id, effectiveFrom: created.effectiveFrom.toISOString() };
    });
  }

  async listLimitPolicies() {
    const rows = await this.prisma.limitPolicy.findMany({
      orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      parkId: row.parkId,
      currency: row.currency,
      minWithdrawalMinor: row.minWithdrawalMinor.toString(),
      maxWithdrawalMinor: row.maxWithdrawalMinor.toString(),
      dailyAmountMinor: row.dailyAmountMinor.toString(),
      dailyCountMax: row.dailyCountMax,
      weeklyAmountMinor: row.weeklyAmountMinor.toString(),
      monthlyAmountMinor: row.monthlyAmountMinor.toString(),
      velocityWindowSeconds: row.velocityWindowSeconds,
      velocityMaxCount: row.velocityMaxCount,
      manualReviewAboveMinor: row.manualReviewAboveMinor?.toString() ?? null,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      active: row.effectiveTo === null,
    }));
  }

  async replaceLimitPolicy(
    dto: z.infer<typeof PricingService.limitPolicySchema>,
    adminId: string,
  ) {
    if (BigInt(dto.minWithdrawalMinor) > BigInt(dto.maxWithdrawalMinor)) {
      throw new AppError('VALIDATION_FAILED', 'The minimum cannot exceed the maximum');
    }
    if (BigInt(dto.dailyAmountMinor) > BigInt(dto.weeklyAmountMinor)) {
      throw new AppError('VALIDATION_FAILED', 'The daily cap cannot exceed the weekly cap');
    }
    if (BigInt(dto.weeklyAmountMinor) > BigInt(dto.monthlyAmountMinor)) {
      throw new AppError('VALIDATION_FAILED', 'The weekly cap cannot exceed the monthly cap');
    }

    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.limitPolicy.findFirst({
        where: { parkId: dto.parkId, currency: dto.currency, effectiveTo: null },
      });
      if (previous) {
        await tx.limitPolicy.update({ where: { id: previous.id }, data: { effectiveTo: now } });
      }
      const created = await tx.limitPolicy.create({
        data: {
          parkId: dto.parkId,
          currency: dto.currency,
          minWithdrawalMinor: BigInt(dto.minWithdrawalMinor),
          maxWithdrawalMinor: BigInt(dto.maxWithdrawalMinor),
          dailyAmountMinor: BigInt(dto.dailyAmountMinor),
          dailyCountMax: dto.dailyCountMax,
          weeklyAmountMinor: BigInt(dto.weeklyAmountMinor),
          monthlyAmountMinor: BigInt(dto.monthlyAmountMinor),
          velocityWindowSeconds: dto.velocityWindowSeconds,
          velocityMaxCount: dto.velocityMaxCount,
          manualReviewAboveMinor:
            dto.manualReviewAboveMinor === null ? null : BigInt(dto.manualReviewAboveMinor),
          effectiveFrom: now,
          createdByAdminId: adminId,
        },
      });

      await this.audit.record(
        {
          action: 'limits.changed',
          subjectType: 'limit_policy',
          subjectId: created.id,
          actorType: 'ADMIN',
          actorId: adminId,
          reason: dto.reason,
          before: previous ? { id: previous.id } : undefined,
        },
        tx,
      );

      return { id: created.id, effectiveFrom: created.effectiveFrom.toISOString() };
    });
  }
}
