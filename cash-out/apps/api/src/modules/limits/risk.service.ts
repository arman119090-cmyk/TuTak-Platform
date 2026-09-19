import { Injectable } from '@nestjs/common';
import { Money } from '@cashout/money';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { Clock } from '../../common/clock';

export interface RiskInput {
  readonly driverId: string;
  readonly payoutMethodId: string;
  readonly payoutMethodFingerprint: string;
  readonly gross: Money;
  readonly deviceId?: string;
}

export interface RiskAssessment {
  readonly score: number;
  readonly reasons: readonly string[];
  readonly requiresManualReview: boolean;
}

/**
 * A deliberately small, explainable risk model.
 *
 * Every signal here is one a support agent can verify by looking at the same
 * data, and each carries a fixed weight. That matters more than sophistication:
 * a driver who is held for review is owed an answer to "why", and an opaque
 * score cannot give one. The thresholds are configuration, not folklore, and
 * the reasons are written verbatim into the withdrawal's manual-review note.
 */
@Injectable()
export class RiskService {
  /** At or above this, the withdrawal goes to a human instead of to the bank. */
  static readonly MANUAL_REVIEW_THRESHOLD = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async assess(input: RiskInput, tx?: TransactionClient): Promise<RiskAssessment> {
    const client = tx ?? this.prisma;
    const reasons: string[] = [];
    let score = 0;

    const driver = await client.driver.findUnique({
      where: { id: input.driverId },
      select: { createdAt: true, riskTier: true, verifiedAt: true },
    });

    const accountAgeHours = driver
      ? (this.clock.nowMs() - driver.createdAt.getTime()) / 3_600_000
      : 0;
    if (accountAgeHours < 24) {
      score += 25;
      reasons.push('account_less_than_24h_old');
    }

    if (driver?.riskTier === 'ELEVATED') {
      score += 30;
      reasons.push('driver_marked_elevated_risk');
    }

    // The same card on more than one driver is the classic mule pattern.
    const sharedInstrument = await client.payoutMethod.count({
      where: {
        fingerprint: input.payoutMethodFingerprint,
        driverId: { not: input.driverId },
        disabledAt: null,
      },
    });
    if (sharedInstrument > 0) {
      score += 45;
      reasons.push(`payout_instrument_shared_with_${sharedInstrument}_other_drivers`);
    }

    const methodAddedAt = await client.payoutMethod.findUnique({
      where: { id: input.payoutMethodId },
      select: { createdAt: true },
    });
    if (methodAddedAt) {
      const ageMinutes = (this.clock.nowMs() - methodAddedAt.createdAt.getTime()) / 60_000;
      if (ageMinutes < 15) {
        score += 20;
        reasons.push('payout_method_added_minutes_ago');
      }
    }

    const recentFailures = await client.withdrawal.count({
      where: {
        driverId: input.driverId,
        createdAt: { gte: new Date(this.clock.nowMs() - 24 * 3_600_000) },
        state: { in: ['REVERSED', 'PAYOUT_FAILED', 'PAYOUT_RETURNED', 'MANUAL_REVIEW'] },
      },
    });
    if (recentFailures >= 2) {
      score += 25;
      reasons.push(`${recentFailures}_failed_or_reviewed_withdrawals_in_24h`);
    }

    const distinctDevices = await client.session.findMany({
      where: {
        user: { driver: { id: input.driverId } },
        createdAt: { gte: new Date(this.clock.nowMs() - 24 * 3_600_000) },
      },
      select: { deviceRowId: true },
      distinct: ['deviceRowId'],
    });
    if (distinctDevices.length >= 3) {
      score += 15;
      reasons.push(`${distinctDevices.length}_devices_signed_in_within_24h`);
    }

    return {
      score,
      reasons,
      requiresManualReview: score >= RiskService.MANUAL_REVIEW_THRESHOLD,
    };
  }
}
