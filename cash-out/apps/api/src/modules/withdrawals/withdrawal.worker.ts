import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WithdrawalOrchestrator } from './withdrawal.orchestrator';

/**
 * The sweeper.
 *
 * Every state change in the product is driven from a row, not from a promise
 * held in memory: if the process that started a withdrawal dies, this picks it
 * up. That is the difference between "usually finishes" and "always finishes".
 *
 * Three passes, in order of urgency:
 *   - anything actionable whose backoff has elapsed;
 *   - anything holding a lease from a process that is no longer running;
 *   - anything past its SLA, which becomes a human's problem rather than
 *     silently ageing in a queue.
 */
@Injectable()
export class WithdrawalWorker {
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly orchestrator: WithdrawalOrchestrator,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
      await this.escalateOverdue();
    } catch (error) {
      this.logger.fail('Withdrawal worker tick failed', error);
    } finally {
      this.running = false;
    }
  }

  async sweep(batchSize = 25): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.withdrawal.findMany({
      where: {
        state: { notIn: ['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED', 'MANUAL_REVIEW', 'RISK_REVIEW'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }],
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    let advanced = 0;
    for (const { id } of due) {
      try {
        const state = await this.orchestrator.advance(id);
        if (state) advanced += 1;
      } catch (error) {
        this.logger.fail('Failed to advance a withdrawal', error, { withdrawalId: id });
      }
    }
    return advanced;
  }

  /**
   * A withdrawal that has passed its SLA while still holding a debit is money
   * taken from a driver that has not reached them. That is never allowed to sit
   * quietly.
   */
  async escalateOverdue(): Promise<number> {
    const overdue = await this.prisma.withdrawal.findMany({
      where: {
        state: {
          in: [
            'RESERVED',
            'PAYOUT_SUBMITTING',
            'PAYOUT_UNCERTAIN',
            'PAYOUT_SUBMITTED',
            'PAYOUT_FAILED',
            'PAYOUT_RETURNED',
            'COMPENSATING',
            'RESERVE_UNCERTAIN',
          ],
        },
        slaDeadline: { lt: this.clock.now() },
      },
      take: 25,
    });

    for (const withdrawal of overdue) {
      await this.orchestrator.escalate(
        withdrawal,
        `Still ${withdrawal.state} after the ${this.env.WITHDRAWAL_SLA_SECONDS}s SLA`,
      );
    }
    return overdue.length;
  }
}
