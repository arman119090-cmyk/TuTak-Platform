import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AutoPayoutRule } from '@prisma/client';
import {
  AutoPayoutConstraintsDto,
  AutoPayoutRuleDto,
  AutoPayoutStateDto,
  UpsertAutoPayoutDto,
} from '@cashout/contracts';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ENV, Env } from '../../config/env';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { BalanceService } from '../drivers/balance.service';
import { LimitsService } from '../limits/limits.service';
import { MembershipService } from '../parks/membership.service';
import { PayoutMethodsService } from '../payout-methods/payout-methods.service';
import { SecurityService } from '../security/security.service';
import { QuoteService } from '../withdrawals/quote.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { nextCheckAt } from './schedule';

export type EvaluationOutcome =
  | { readonly outcome: 'CREATED'; readonly withdrawalId: string }
  | { readonly outcome: 'BELOW_THRESHOLD' }
  | { readonly outcome: 'BELOW_MINIMUM' }
  | { readonly outcome: 'SKIPPED'; readonly reason: string }
  | { readonly outcome: 'FAILED'; readonly code: string; readonly paused: boolean }
  | { readonly outcome: 'PAUSED'; readonly reason: string };

/**
 * Automatic payouts.
 *
 * A rule is a standing instruction: when the available balance in the
 * driver's park reaches a threshold — on a schedule, or whenever it happens —
 * withdraw it to the driver's iDram account. What the rule does when it fires
 * is *exactly* what the driver does by hand: a quote, then a withdrawal
 * through the same service, the same checks, the same pipeline. There is no
 * second money path.
 *
 * Consent is the PIN/biometric authorization spent when the rule is enabled;
 * its method is recorded on the rule. A rule pauses itself after repeated
 * failures, or the moment the park, the membership or the destination stops
 * being usable, and says why.
 */
@Injectable()
export class AutoPayoutService {
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
    private readonly balances: BalanceService,
    private readonly limits: LimitsService,
    private readonly payoutMethods: PayoutMethodsService,
    private readonly security: SecurityService,
    private readonly quotes: QuoteService,
    private readonly withdrawals: WithdrawalsService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly logger: AppLogger,
  ) {}

  // ------------------------------------------------------------- driver API

  async state(driverId: string): Promise<AutoPayoutStateDto> {
    const rule = await this.prisma.autoPayoutRule.findUnique({ where: { driverId } });
    return {
      rule: rule ? await this.toDto(rule) : null,
      constraints: await this.constraints(driverId),
    };
  }

  async constraints(driverId: string): Promise<AutoPayoutConstraintsDto> {
    let parkId: string | null = null;
    let currency = 'AMD';
    try {
      const context = await this.memberships.requireActive(driverId);
      parkId = context.park.id;
      currency = context.park.currency;
    } catch {
      // No active park: the defaults still describe what the form may offer.
    }
    const limits = await this.limits.resolve(parkId, currency);
    return {
      minThreshold: limits.min.toJSON(),
      maxPayout: limits.max.toJSON(),
      cadences: ['ON_THRESHOLD', 'DAILY', 'WEEKLY'],
      checkIntervalSeconds: this.env.AUTO_PAYOUT_CHECK_INTERVAL_SECONDS,
      timezone: 'Asia/Yerevan',
    };
  }

  /**
   * Enables or changes the rule. Requires an active park, a verified iDram
   * destination, values inside the park's limits, and a spent AUTO_PAYOUT
   * authorization — the driver's consent.
   */
  async upsert(driverId: string, dto: UpsertAutoPayoutDto): Promise<AutoPayoutRuleDto> {
    const { park } = await this.memberships.requireActive(driverId);
    const destination = await this.prisma.payoutMethod.findFirst({
      where: { driverId, kind: 'IDRAM', disabledAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!destination) {
      throw new AppError('IDRAM_ACCOUNT_NOT_LINKED', 'Link an iDram account first');
    }
    if (destination.status !== 'ACTIVE') {
      throw new AppError('PAYOUT_METHOD_NOT_VERIFIED', 'The iDram account is not verified yet');
    }

    const currency = park.currency as CurrencyCode;
    const threshold = Money.fromMinor(dto.threshold.minor, dto.threshold.currency as CurrencyCode);
    const maxPayout = dto.maxPayout
      ? Money.fromMinor(dto.maxPayout.minor, dto.maxPayout.currency as CurrencyCode)
      : null;
    if (threshold.currency !== currency || (maxPayout && maxPayout.currency !== currency)) {
      throw new AppError('AUTO_PAYOUT_INVALID', `Amounts must be in ${currency}`);
    }
    const limits = await this.limits.resolve(park.id, currency);
    if (threshold.lessThan(limits.min)) {
      throw new AppError('AUTO_PAYOUT_INVALID', 'The threshold is below the minimum payout', {
        minThreshold: limits.min.toJSON(),
      });
    }
    if (maxPayout && (maxPayout.greaterThan(limits.max) || maxPayout.lessThan(limits.min))) {
      throw new AppError('AUTO_PAYOUT_INVALID', 'The maximum payout is outside the allowed range', {
        minThreshold: limits.min.toJSON(),
        maxPayout: limits.max.toJSON(),
      });
    }

    const schedule = {
      cadence: dto.cadence,
      runHour: dto.cadence === 'ON_THRESHOLD' ? null : (dto.runHour ?? null),
      runWeekday: dto.cadence === 'WEEKLY' ? (dto.runWeekday ?? null) : null,
      timezone: 'Asia/Yerevan',
      checkIntervalSeconds: this.env.AUTO_PAYOUT_CHECK_INTERVAL_SECONDS,
    };
    // An ON_THRESHOLD rule is checked at once; a scheduled one at its first slot.
    const firstCheck =
      dto.cadence === 'ON_THRESHOLD' ? this.clock.now() : nextCheckAt(schedule, this.clock.now());

    const rule = await this.prisma.$transaction(async (tx) => {
      const authorization = await this.security.consume(tx, {
        driverId,
        token: dto.authorizationToken,
        quoteId: '',
        purpose: 'AUTO_PAYOUT',
      });
      const before = await tx.autoPayoutRule.findUnique({ where: { driverId } });
      const data = {
        parkId: park.id,
        payoutMethodId: destination.id,
        enabled: true,
        cadence: dto.cadence,
        currency,
        thresholdMinor: threshold.minor,
        maxPayoutMinor: maxPayout?.minor ?? null,
        runHour: schedule.runHour,
        runWeekday: schedule.runWeekday,
        timezone: schedule.timezone,
        nextCheckAt: firstCheck,
        consecutiveFailures: 0,
        lastFailureCode: null,
        lastFailureAt: null,
        pausedAt: null,
        pausedReason: null,
        authorizationMethod: authorization.method,
      };
      const row = before
        ? await tx.autoPayoutRule.update({ where: { driverId }, data })
        : await tx.autoPayoutRule.create({ data: { driverId, ...data } });
      await this.audit.record(
        {
          action: before ? 'auto_payout.updated' : 'auto_payout.enabled',
          subjectType: 'auto_payout_rule',
          subjectId: row.id,
          actorType: 'DRIVER',
          actorId: driverId,
          before: before
            ? {
                enabled: before.enabled,
                cadence: before.cadence,
                threshold: before.thresholdMinor.toString(),
              }
            : undefined,
          after: {
            cadence: row.cadence,
            threshold: row.thresholdMinor.toString(),
            maxPayout: row.maxPayoutMinor?.toString() ?? null,
            authorization: authorization.method,
          },
        },
        tx,
      );
      return row;
    });

    return this.toDto(rule);
  }

  /** Turning it off needs no authorization: stopping money is always allowed. */
  async disable(driverId: string): Promise<void> {
    const rule = await this.prisma.autoPayoutRule.findUnique({ where: { driverId } });
    if (!rule || !rule.enabled) return;
    await this.prisma.autoPayoutRule.update({ where: { driverId }, data: { enabled: false } });
    await this.audit.record({
      action: 'auto_payout.disabled',
      subjectType: 'auto_payout_rule',
      subjectId: rule.id,
      actorType: 'DRIVER',
      actorId: driverId,
    });
  }

  // ---------------------------------------------------------------- worker

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.evaluateDue();
    } catch (error) {
      this.logger.fail('Auto payout tick failed', error);
    } finally {
      this.running = false;
    }
  }

  async evaluateDue(batchSize = 50): Promise<number> {
    const due = await this.prisma.autoPayoutRule.findMany({
      where: { enabled: true, pausedAt: null, nextCheckAt: { lte: this.clock.now() } },
      orderBy: { nextCheckAt: 'asc' },
      take: batchSize,
    });
    let evaluated = 0;
    for (const rule of due) {
      try {
        await this.evaluate(rule.id);
        evaluated += 1;
      } catch (error) {
        this.logger.fail('Auto payout evaluation crashed', error, { ruleId: rule.id });
      }
    }
    return evaluated;
  }

  /**
   * One evaluation of one rule. Every exit updates the row so that the same
   * slot is never processed twice: the idempotency key of the withdrawal is
   * derived from the slot, and a crash between "created" and "recorded" is
   * answered by the withdrawal service's idempotency, not by a second payout.
   */
  async evaluate(ruleId: string): Promise<EvaluationOutcome> {
    const rule = await this.prisma.autoPayoutRule.findUniqueOrThrow({ where: { id: ruleId } });
    if (!rule.enabled || rule.pausedAt) return { outcome: 'SKIPPED', reason: 'inactive' };

    const slot = rule.nextCheckAt;
    const now = this.clock.now();

    // The park and the destination must still be the ones the driver consented to.
    let parkOk = false;
    try {
      const context = await this.memberships.requireActive(rule.driverId);
      parkOk = context.park.id === rule.parkId;
      if (!parkOk) return this.pause(rule, 'park_changed');
    } catch (error) {
      return this.pause(rule, error instanceof AppError ? error.code : 'park_unavailable');
    }

    try {
      await this.payoutMethods.requireUsable(rule.driverId, rule.payoutMethodId);
    } catch (error) {
      return this.pause(rule, error instanceof AppError ? error.code : 'destination_unusable');
    }

    const live = await this.prisma.withdrawal.count({
      where: {
        driverId: rule.driverId,
        state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED'] },
      },
    });
    if (live > 0) {
      await this.reschedule(rule, now, { lastCheckedAt: now });
      return { outcome: 'SKIPPED', reason: 'withdrawal_in_progress' };
    }

    let withdrawable: Money;
    try {
      withdrawable = (await this.balances.requireFresh(rule.driverId)).withdrawable;
    } catch (error) {
      return this.fail(rule, now, error instanceof AppError ? error.code : 'BALANCE_UNAVAILABLE');
    }

    const threshold = Money.fromMinor(rule.thresholdMinor, rule.currency as CurrencyCode);
    if (withdrawable.lessThan(threshold)) {
      await this.reschedule(rule, now, { lastCheckedAt: now, consecutiveFailures: 0 });
      return { outcome: 'BELOW_THRESHOLD' };
    }

    const cap = rule.maxPayoutMinor
      ? Money.fromMinor(rule.maxPayoutMinor, rule.currency as CurrencyCode)
      : withdrawable;
    const amount = Money.min(withdrawable, cap);
    const limits = await this.limits.resolve(rule.parkId, rule.currency);
    if (amount.lessThan(limits.min)) {
      await this.reschedule(rule, now, { lastCheckedAt: now });
      return { outcome: 'BELOW_MINIMUM' };
    }

    try {
      const quote = await this.quotes.create(rule.driverId, {
        payoutMethodId: rule.payoutMethodId,
        amount: amount.toJSON(),
        all: false,
      });
      const created = await this.withdrawals.confirmAutomatic(
        rule.driverId,
        {
          quoteId: quote.quoteId,
          signature: quote.signature,
          idempotencyKey: slotKey(rule.id, slot),
        },
        rule.id,
      );
      await this.reschedule(rule, now, {
        lastCheckedAt: now,
        lastRunAt: now,
        lastWithdrawalId: created.id,
        consecutiveFailures: 0,
        lastFailureCode: null,
      });
      await this.audit.record({
        action: 'auto_payout.withdrawal_created',
        subjectType: 'auto_payout_rule',
        subjectId: rule.id,
        actorType: 'SYSTEM',
        after: { withdrawalId: created.id, gross: amount.minor.toString() },
      });
      await this.notifications.enqueue({
        driverId: rule.driverId,
        kind: 'AUTO_PAYOUT_CREATED',
        payload: { withdrawalId: created.id, grossMinor: amount.minor.toString() },
      });
      return { outcome: 'CREATED', withdrawalId: created.id };
    } catch (error) {
      return this.fail(rule, now, error instanceof AppError ? error.code : 'INTERNAL_ERROR');
    }
  }

  // ------------------------------------------------------------------ internals

  private async fail(rule: AutoPayoutRule, now: Date, code: string): Promise<EvaluationOutcome> {
    const failures = rule.consecutiveFailures + 1;
    const paused = failures >= this.env.AUTO_PAYOUT_MAX_FAILURES;
    await this.prisma.autoPayoutRule.update({
      where: { id: rule.id },
      data: {
        lastCheckedAt: now,
        consecutiveFailures: failures,
        lastFailureCode: code,
        lastFailureAt: now,
        nextCheckAt: this.nextFor(rule, now),
        ...(paused ? { pausedAt: now, pausedReason: `repeated_failures:${code}` } : {}),
      },
    });
    await this.audit.record({
      action: paused ? 'auto_payout.paused' : 'auto_payout.failed',
      subjectType: 'auto_payout_rule',
      subjectId: rule.id,
      actorType: 'SYSTEM',
      after: { code, failures },
    });
    if (paused) {
      await this.notifications.enqueue({
        driverId: rule.driverId,
        kind: 'AUTO_PAYOUT_PAUSED',
        payload: { reason: `repeated_failures:${code}` },
      });
    }
    this.logger.warning('Auto payout evaluation failed', { ruleId: rule.id, code, paused });
    return { outcome: 'FAILED', code, paused };
  }

  private async pause(rule: AutoPayoutRule, reason: string): Promise<EvaluationOutcome> {
    const now = this.clock.now();
    await this.prisma.autoPayoutRule.update({
      where: { id: rule.id },
      data: { lastCheckedAt: now, pausedAt: now, pausedReason: reason },
    });
    await this.audit.record({
      action: 'auto_payout.paused',
      subjectType: 'auto_payout_rule',
      subjectId: rule.id,
      actorType: 'SYSTEM',
      reason,
    });
    await this.notifications.enqueue({
      driverId: rule.driverId,
      kind: 'AUTO_PAYOUT_PAUSED',
      payload: { reason },
    });
    return { outcome: 'PAUSED', reason };
  }

  private async reschedule(
    rule: AutoPayoutRule,
    now: Date,
    data: Partial<{
      lastCheckedAt: Date;
      lastRunAt: Date;
      lastWithdrawalId: string;
      consecutiveFailures: number;
      lastFailureCode: string | null;
    }>,
  ): Promise<void> {
    await this.prisma.autoPayoutRule.update({
      where: { id: rule.id },
      data: { ...data, nextCheckAt: this.nextFor(rule, now) },
    });
  }

  private nextFor(rule: AutoPayoutRule, now: Date): Date {
    return nextCheckAt(
      {
        cadence: rule.cadence,
        runHour: rule.runHour,
        runWeekday: rule.runWeekday,
        timezone: rule.timezone,
        checkIntervalSeconds: this.env.AUTO_PAYOUT_CHECK_INTERVAL_SECONDS,
      },
      now,
    );
  }

  private async toDto(rule: AutoPayoutRule): Promise<AutoPayoutRuleDto> {
    const [park, method] = await Promise.all([
      this.prisma.park.findUnique({ where: { id: rule.parkId }, select: { id: true, name: true } }),
      this.prisma.payoutMethod.findUnique({
        where: { id: rule.payoutMethodId },
        select: { id: true, maskedIdentifier: true, displayName: true, status: true },
      }),
    ]);
    const money = (minor: bigint) => Money.fromMinor(minor, rule.currency as CurrencyCode).toJSON();
    return {
      id: rule.id,
      enabled: rule.enabled,
      paused: rule.pausedAt !== null,
      pausedReason: rule.pausedReason,
      cadence: rule.cadence,
      threshold: money(rule.thresholdMinor),
      maxPayout: rule.maxPayoutMinor === null ? null : money(rule.maxPayoutMinor),
      runHour: rule.runHour,
      runWeekday: rule.runWeekday,
      timezone: rule.timezone,
      park: { id: rule.parkId, name: park?.name ?? '—' },
      destination: {
        id: rule.payoutMethodId,
        maskedIdentifier: method?.maskedIdentifier ?? '••••',
        displayName: method?.displayName ?? null,
        status: method?.status ?? 'DISABLED',
      },
      nextCheckAt: rule.enabled && !rule.pausedAt ? rule.nextCheckAt.toISOString() : null,
      lastRunAt: rule.lastRunAt?.toISOString() ?? null,
      lastWithdrawalId: rule.lastWithdrawalId,
      lastFailureCode: rule.lastFailureCode,
      consecutiveFailures: rule.consecutiveFailures,
      authorizationMethod: rule.authorizationMethod,
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}

/** One withdrawal per rule per slot, however many times the slot is evaluated. */
export function slotKey(ruleId: string, slot: Date): string {
  return `auto-${ruleId.replace(/-/g, '').slice(0, 16)}-${slot.getTime().toString(36)}`;
}
