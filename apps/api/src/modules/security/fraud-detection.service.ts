import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BonusLotStatus,
  FraudSignalSeverity,
  FraudSignalType,
  Prisma,
  PurchaseIntentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** What the pilot rules decided about one purchase before it settles. */
export interface PurchaseRiskAssessment {
  /** True when at least one rule fired: hold the customer's green reward. */
  hold: boolean;
  /** Stable rule names, e.g. `partner_velocity`, `high_value`. Empty when clean. */
  reasons: string[];
  /** Hours the held reward stays PENDING (from config), 0 when not held. */
  holdHours: number;
}

/**
 * Lightweight rule-based fraud signal engine. Intentionally simple and
 * synchronous so it can run inline on the hot path without external
 * dependencies; the FraudSignal table is designed so a future ML scoring
 * job can write richer signals alongside these without a schema change.
 */
@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Returns true if the user is currently transacting at an anomalous velocity.
   *
   * The window and the ceiling come from `FRAUD_VELOCITY_WINDOW_MINUTES` /
   * `FRAUD_VELOCITY_MAX_TRANSACTIONS` (defaults 10 / 8 — the values that were
   * constants until 26.09.2026), so the pilot can be tightened from the
   * environment rather than a release. A held payment is a `FraudSignal` an
   * admin resolves, never a silent drop.
   */
  async checkVelocity(userId: string, relatedTransactionId?: string): Promise<boolean> {
    const { velocityWindowMinutes, velocityMaxTransactions } = this.config.get('fraud', {
      infer: true,
    });
    const since = new Date(Date.now() - velocityWindowMinutes * 60_000);
    const recentCount = await this.prisma.transaction.count({
      where: { userId, createdAt: { gte: since } },
    });

    if (recentCount >= velocityMaxTransactions) {
      await this.raise({
        userId,
        type: FraudSignalType.VELOCITY_LIMIT_EXCEEDED,
        severity: FraudSignalSeverity.MEDIUM,
        relatedTransactionId,
        metadata: {
          recentCount,
          windowMinutes: velocityWindowMinutes,
          maxTransactions: velocityMaxTransactions,
        },
      });
      return true;
    }
    return false;
  }

  /**
   * The pilot's deterministic rules for a purchase about to be confirmed
   * (docs/AI_RISK_ENGINE_DESIGN.md §1-2). Every threshold is configuration;
   * a `0`/`'0'` switches a rule off.
   *
   * The decision is a *hold*, never a refusal: the sale at the till goes
   * through, the customer's green reward is accrued PENDING for
   * `rewardHoldHours` instead of AVAILABLE, and a `FraudSignal` is raised for
   * an administrator, whose `resolve` releases the reward early. Refusing
   * the purchase would punish the customer standing at the counter for a
   * pattern that is usually the partner's or a script's; holding the reward
   * costs the honest customer a delay and costs the abuser the payout.
   *
   * Reads only; the signal is written here, the hold is applied by the
   * caller inside the settlement transaction.
   */
  async assessPurchase(params: {
    customerId: string;
    partnerId: string;
    branchId?: string | null;
    staffUserId?: string | null;
    grossAmount: Decimal;
    sourceTransactionId?: string | null;
  }): Promise<PurchaseRiskAssessment> {
    const cfg = this.config.get('fraud', { infer: true });
    const since = new Date(Date.now() - cfg.velocityWindowMinutes * 60_000);
    const reasons: string[] = [];
    const facts: Record<string, unknown> = {};

    const confirmedSince = (where: Prisma.PurchaseIntentWhereInput) =>
      this.prisma.purchaseIntent.count({
        where: { ...where, status: PurchaseIntentStatus.CONFIRMED, confirmedAt: { gte: since } },
      });

    if (cfg.partnerVelocityMax > 0) {
      const n = await confirmedSince({ partnerId: params.partnerId });
      if (n >= cfg.partnerVelocityMax) {
        reasons.push('partner_velocity');
        facts.partnerConfirmed = n;
      }
    }
    if (cfg.branchVelocityMax > 0 && params.branchId) {
      const n = await confirmedSince({ partnerBranchId: params.branchId });
      if (n >= cfg.branchVelocityMax) {
        reasons.push('branch_velocity');
        facts.branchConfirmed = n;
      }
    }
    if (cfg.employeeVelocityMax > 0 && params.staffUserId) {
      const n = await confirmedSince({ confirmedByUserId: params.staffUserId });
      if (n >= cfg.employeeVelocityMax) {
        reasons.push('employee_velocity');
        facts.employeeConfirmed = n;
      }
    }
    const highValue = new Decimal(cfg.highValueAmount || 0);
    if (highValue.greaterThan(0) && params.grossAmount.greaterThanOrEqualTo(highValue)) {
      reasons.push('high_value');
      facts.grossAmount = params.grossAmount.toString();
    }
    if (cfg.newAccountMaxPurchases > 0 && cfg.newAccountHours > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: params.customerId },
        select: { createdAt: true },
      });
      const young = user && user.createdAt.getTime() > Date.now() - cfg.newAccountHours * 3_600_000;
      if (young) {
        const n = await this.prisma.purchaseIntent.count({
          where: { customerId: params.customerId, status: PurchaseIntentStatus.CONFIRMED },
        });
        if (n >= cfg.newAccountMaxPurchases) {
          reasons.push('new_account_burst');
          facts.customerConfirmed = n;
          facts.accountAgeHours = Number(
            ((Date.now() - user.createdAt.getTime()) / 3_600_000).toFixed(2),
          );
        }
      }
    }

    if (reasons.length === 0) return { hold: false, reasons, holdHours: 0 };

    const velocity = reasons.some((r) => r.endsWith('_velocity'));
    await this.raise({
      userId: params.customerId,
      type: velocity ? FraudSignalType.VELOCITY_LIMIT_EXCEEDED : FraudSignalType.BONUS_ABUSE_PATTERN,
      severity: reasons.includes('high_value') ? FraudSignalSeverity.HIGH : FraudSignalSeverity.MEDIUM,
      relatedTransactionId: params.sourceTransactionId ?? undefined,
      metadata: {
        rules: reasons,
        partnerId: params.partnerId,
        branchId: params.branchId ?? null,
        staffUserId: params.staffUserId ?? null,
        windowMinutes: cfg.velocityWindowMinutes,
        rewardHoldHours: cfg.rewardHoldHours,
        action: 'REWARD_HOLD',
        ...facts,
      },
    });
    return { hold: true, reasons, holdHours: cfg.rewardHoldHours };
  }

  async raise(params: {
    userId?: string;
    type: FraudSignalType;
    severity: FraudSignalSeverity;
    relatedTransactionId?: string;
    metadata?: Record<string, unknown>;
  }) {
    this.logger.warn(`Fraud signal raised: ${params.type} (${params.severity}) user=${params.userId}`);
    return this.prisma.fraudSignal.create({
      data: {
        userId: params.userId,
        type: params.type,
        severity: params.severity,
        relatedTransactionId: params.relatedTransactionId,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  listOpen() {
    return this.prisma.fraudSignal.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * An administrator has looked. Resolving also releases any reward the
   * signal's purchase is still holding: the PENDING lots keyed by that
   * transaction become due now, and the ordinary promotion sweep moves them
   * to AVAILABLE — through the same code path every other pending lot takes,
   * so nothing is minted or moved twice here.
   */
  async resolve(id: string, resolvedByUserId: string) {
    const signal = await this.prisma.fraudSignal.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedByUserId },
    });
    if (signal.relatedTransactionId) {
      const released = await this.prisma.bonusLot.updateMany({
        where: {
          sourceTransactionId: signal.relatedTransactionId,
          status: BonusLotStatus.PENDING,
          availableAt: { gt: new Date() },
        },
        data: { availableAt: new Date() },
      });
      if (released.count > 0) {
        this.logger.log(
          `Fraud signal ${id} resolved by ${resolvedByUserId}: ${released.count} held lot(s) released for promotion`,
        );
      }
    }
    return signal;
  }
}
