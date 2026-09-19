import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Withdrawal, WithdrawalState } from '@prisma/client';
import { Money } from '@cashout/money';
import type { CurrencyCode } from '@cashout/money';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { withSerializationRetry } from '../../prisma/retry';
import { LedgerService } from '../ledger/ledger.service';
import { withdrawalJournal, WithdrawalJournalContext } from '../ledger/withdrawal-journal';
import { PaymentProviderPort } from '../payment-provider/payment-provider.port';
import { PayoutMethodsService } from '../payout-methods/payout-methods.service';
import { RiskService } from '../limits/risk.service';
import { YandexFleetPort } from '../yandex/yandex.port';
import { WithdrawalConflictError, WithdrawalStateService } from './withdrawal-state.service';

/** After this many failed attempts at one step, a human takes over. */
const MAX_STEP_ATTEMPTS = 5;

/**
 * Drives a withdrawal from `CREATED` to a terminal state.
 *
 * ## The rule the whole file is built around
 *
 * Record the intent, then act, then record the outcome — never act first. Each
 * external call is preceded by a state transition into a `*_ING` state, so a
 * process that dies mid-call leaves behind a row that says "we may have called
 * Yandex", and recovery is a probe rather than a guess. The alternative —
 * calling first and writing afterwards — loses exactly the information you need
 * when the crash happens between the two.
 *
 * ## Ordering
 *
 * The Yandex debit always precedes the bank transfer, because the debit can be
 * compensated and a settled transfer cannot. See `@cashout/contracts`'s state
 * machine for the argument in full.
 *
 * ## Idempotency
 *
 * Both external keys — `yandexIdempotencyToken` and `providerIdempotencyKey` —
 * are generated once, when the withdrawal row is created, and stored on it.
 * Every retry of every step reuses them, which is what makes a retry safe even
 * when the previous attempt actually succeeded.
 */
@Injectable()
export class WithdrawalOrchestrator {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly states: WithdrawalStateService,
    private readonly ledger: LedgerService,
    private readonly yandex: YandexFleetPort,
    private readonly provider: PaymentProviderPort,
    private readonly payoutMethods: PayoutMethodsService,
    private readonly risk: RiskService,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Fire-and-forget progress, for callers that must answer a request now — a
   * confirmed withdrawal, a processed webhook, an operator's decision. Failures
   * are logged and left to the worker, which sweeps every actionable row anyway.
   *
   * Honours `ORCHESTRATOR_AUTO_ADVANCE` so that tests drive each step
   * explicitly instead of racing a background promise.
   */
  kick(withdrawalId: string): void {
    if (!this.env.ORCHESTRATOR_AUTO_ADVANCE) return;
    void this.advance(withdrawalId).catch((error: unknown) => {
      this.logger.fail('Background orchestration failed; the worker will retry', error, {
        withdrawalId,
      });
    });
  }

  /**
   * Runs as many steps as can be run right now.
   *
   * Stops when the withdrawal reaches a terminal state, when it is waiting on
   * something external (a webhook, a human, a backoff), or when another worker
   * holds the lease.
   */
  async advance(withdrawalId: string, maxSteps = 8): Promise<WithdrawalState | null> {
    const owner = randomUUID();
    if (!(await this.acquireLease(withdrawalId, owner))) {
      this.logger.debug(`Withdrawal ${withdrawalId} is leased elsewhere`, 'Orchestrator');
      return null;
    }

    try {
      let lastState: WithdrawalState | null = null;
      for (let step = 0; step < maxSteps; step += 1) {
        const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
        if (!withdrawal) return null;
        lastState = withdrawal.state;

        if (!this.isActionable(withdrawal)) return lastState;

        const progressed = await this.step(withdrawal);
        if (!progressed) return lastState;
      }
      return lastState;
    } finally {
      await this.releaseLease(withdrawalId, owner);
    }
  }

  private isActionable(withdrawal: Withdrawal): boolean {
    if (TERMINAL.has(withdrawal.state)) return false;
    if (WAITING.has(withdrawal.state)) return false;
    if (withdrawal.nextAttemptAt && withdrawal.nextAttemptAt.getTime() > this.clock.nowMs()) {
      return false;
    }
    return true;
  }

  private async step(withdrawal: Withdrawal): Promise<boolean> {
    try {
      switch (withdrawal.state) {
        case 'CREATED':
          return await this.toRiskCheck(withdrawal);
        case 'RISK_CHECK':
          return await this.runRiskCheck(withdrawal);
        case 'RESERVING':
          return await this.reserve(withdrawal);
        case 'RESERVE_UNCERTAIN':
          return await this.resolveReserve(withdrawal);
        case 'RESERVED':
          return await this.beginPayout(withdrawal);
        case 'PAYOUT_SUBMITTING':
          return await this.submitPayout(withdrawal);
        case 'PAYOUT_SUBMITTED':
          return await this.probeSubmitted(withdrawal);
        case 'PAYOUT_UNCERTAIN':
          return await this.resolvePayout(withdrawal);
        case 'PAYOUT_CONFIRMED':
          return await this.settle(withdrawal);
        case 'PAYOUT_FAILED':
        case 'PAYOUT_RETURNED':
          return await this.beginCompensation(withdrawal);
        case 'COMPENSATING':
          return await this.compensate(withdrawal);
        default:
          return false;
      }
    } catch (error) {
      if (error instanceof WithdrawalConflictError) {
        // Someone else moved it. Re-read and try again on the next iteration.
        this.logger.info('Withdrawal changed during a step; re-reading', {
          withdrawalId: withdrawal.id,
        });
        return true;
      }
      this.logger.fail('Withdrawal step failed', error, {
        withdrawalId: withdrawal.id,
        state: withdrawal.state,
      });
      await this.backOff(withdrawal, error instanceof Error ? error.message : 'unknown error');
      return false;
    }
  }

  // ------------------------------------------------------------------- steps

  private async toRiskCheck(withdrawal: Withdrawal): Promise<boolean> {
    await this.prisma.inTransaction((tx) =>
      this.states.transition(tx, withdrawal, 'RISK_CHECK', { note: 'automatic checks' }),
    );
    return true;
  }

  private async runRiskCheck(withdrawal: Withdrawal): Promise<boolean> {
    const method = await this.prisma.payoutMethod.findUniqueOrThrow({
      where: { id: withdrawal.payoutMethodId },
    });
    const assessment = await this.risk.assess({
      driverId: withdrawal.driverId,
      payoutMethodId: withdrawal.payoutMethodId,
      payoutMethodFingerprint: method.fingerprint,
      gross: moneyOf(withdrawal.grossMinor, withdrawal.currency),
    });

    await this.prisma.inTransaction(async (tx) => {
      if (assessment.requiresManualReview) {
        await this.states.transition(tx, withdrawal, 'RISK_REVIEW', {
          note: `risk score ${assessment.score}`,
          metadata: { reasons: assessment.reasons },
          data: {
            riskScore: assessment.score,
            manualReviewReason: assessment.reasons.join(', '),
          },
        });
      } else {
        await this.states.transition(tx, withdrawal, 'RESERVING', {
          note: `risk score ${assessment.score}`,
          metadata: { reasons: assessment.reasons },
          data: { riskScore: assessment.score },
        });
      }
    });
    return true;
  }

  /**
   * The Yandex debit.
   *
   * Note what is *not* here: no balance re-read, no "is it still enough".
   * Yandex itself rejects an overdraft, and its answer is the only one that
   * matters at this point — a check of our own would just widen the window
   * between deciding and acting.
   */
  private async reserve(withdrawal: Withdrawal): Promise<boolean> {
    const gross = moneyOf(withdrawal.grossMinor, withdrawal.currency);
    const outcome = await this.yandex.createDebit({
      parkId: withdrawal.parkId,
      contractorProfileId: withdrawal.yandexContractorProfileId,
      amount: gross,
      categoryId: this.env.YANDEX_PAYOUT_CATEGORY_ID ?? 'partner_service_manual',
      description: `Cash Out ${withdrawal.reference}`,
      idempotencyToken: withdrawal.yandexIdempotencyToken,
    });

    switch (outcome.status) {
      case 'APPLIED':
        await this.markReserved(withdrawal, outcome.transaction.id, outcome.balanceAfter);
        return true;

      case 'REJECTED':
        // Nothing moved, so this is a clean failure with nothing to compensate.
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'FAILED', {
            note: `Yandex rejected the debit: ${outcome.code}`,
            data: { failureCode: outcome.code, failureMessage: outcome.message },
          }),
        );
        return true;

      case 'UNKNOWN':
      default:
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'RESERVE_UNCERTAIN', {
            note: `Yandex outcome unknown: ${outcome.reason}`,
            data: { attempts: { increment: 1 } },
          }),
        );
        return true;
    }
  }

  /**
   * Resolves an unknown Yandex outcome by looking for the transaction we may
   * have created. The reference is embedded in the description precisely so
   * that this lookup is possible.
   */
  private async resolveReserve(withdrawal: Withdrawal): Promise<boolean> {
    const found = await this.yandex.findTransaction(
      withdrawal.parkId,
      withdrawal.yandexContractorProfileId,
      withdrawal.reference,
      new Date(withdrawal.createdAt.getTime() - 60_000),
    );

    if (found) {
      await this.markReserved(withdrawal, found.id, null);
      return true;
    }

    if (withdrawal.attempts >= MAX_STEP_ATTEMPTS) {
      await this.escalate(
        withdrawal,
        `Could not determine whether the Yandex debit was applied after ${withdrawal.attempts} attempts`,
      );
      return true;
    }

    // Not found and we still have attempts: retry the debit. Safe because the
    // idempotency token is unchanged — if it did land, Yandex returns the same
    // transaction rather than creating a second one.
    await this.prisma.inTransaction((tx) =>
      this.states.transition(tx, withdrawal, 'RESERVING', {
        note: 'debit not found; retrying with the same idempotency token',
        data: { nextAttemptAt: this.backoffDeadline(withdrawal.attempts) },
      }),
    );
    return true;
  }

  private async markReserved(
    withdrawal: Withdrawal,
    yandexTransactionId: string,
    balanceAfter: Money | null,
  ): Promise<void> {
    await withSerializationRetry(() =>
      this.prisma.inSerializableTransaction(async (tx) => {
        const context = this.journalContext(withdrawal);
        await this.ledger.post(tx, withdrawalJournal.reserve(context));
        await this.ledger.post(tx, withdrawalJournal.feeCapture(context));
        await this.states.transition(tx, withdrawal, 'RESERVED', {
          note: `Yandex transaction ${yandexTransactionId}`,
          data: {
            yandexTransactionId,
            yandexBalanceAfterMinor: balanceAfter?.minor ?? null,
            attempts: 0,
            nextAttemptAt: null,
          },
        });
      }),
    );
  }

  private async beginPayout(withdrawal: Withdrawal): Promise<boolean> {
    await this.prisma.inTransaction((tx) =>
      this.states.transition(tx, withdrawal, 'PAYOUT_SUBMITTING', {
        note: 'instructing the payment provider',
      }),
    );
    return true;
  }

  private async submitPayout(withdrawal: Withdrawal): Promise<boolean> {
    const net = moneyOf(withdrawal.netMinor, withdrawal.currency);
    const token = await this.payoutMethods.resolveToken(withdrawal.payoutMethodId);

    const outcome = await this.provider.createPayout({
      idempotencyKey: withdrawal.providerIdempotencyKey,
      reference: withdrawal.reference,
      amount: net,
      instrumentToken: token,
      description: `Cash Out ${withdrawal.reference}`,
    });

    return this.applyPayoutOutcome(withdrawal, outcome);
  }

  private async resolvePayout(withdrawal: Withdrawal): Promise<boolean> {
    const outcome = await this.provider.probe(withdrawal.providerIdempotencyKey);

    if (outcome.status === 'NOT_FOUND') {
      if (withdrawal.attempts >= MAX_STEP_ATTEMPTS) {
        await this.escalate(
          withdrawal,
          'The provider does not recognise this payout after repeated probes',
        );
        return true;
      }
      // The provider has no record of it, so submitting again cannot duplicate
      // — and the idempotency key is unchanged either way.
      await this.prisma.inTransaction((tx) =>
        this.states.transition(tx, withdrawal, 'PAYOUT_SUBMITTING', {
          note: 'provider has no record of this payout; resubmitting',
          data: { nextAttemptAt: null },
        }),
      );
      return true;
    }

    return this.applyPayoutOutcome(withdrawal, outcome);
  }

  /**
   * A payout the provider accepted but has not settled. The webhook is the
   * expected way this ends; this poll is the safety net for the webhook that
   * never arrives, and it only ever moves the withdrawal on a definite answer.
   */
  private async probeSubmitted(withdrawal: Withdrawal): Promise<boolean> {
    const outcome = await this.provider.probe(withdrawal.providerIdempotencyKey);

    if (outcome.status === 'CONFIRMED' || outcome.status === 'REJECTED') {
      return this.applyPayoutOutcome(withdrawal, outcome);
    }

    const submittedFor =
      (this.clock.nowMs() - (withdrawal.submittedAt ?? withdrawal.createdAt).getTime()) / 1000;
    if (submittedFor > this.env.WITHDRAWAL_SLA_SECONDS) {
      await this.escalate(
        withdrawal,
        `The provider has not settled this payout within ${this.env.WITHDRAWAL_SLA_SECONDS}s`,
      );
      return true;
    }

    await this.prisma.inTransaction((tx) =>
      this.states.patch(tx, withdrawal, {
        nextAttemptAt: this.backoffDeadline(withdrawal.attempts),
        attempts: { increment: 1 },
      }),
    );
    return false;
  }

  private async applyPayoutOutcome(
    withdrawal: Withdrawal,
    outcome: Awaited<ReturnType<PaymentProviderPort['createPayout']>>,
  ): Promise<boolean> {
    switch (outcome.status) {
      case 'CONFIRMED':
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'PAYOUT_CONFIRMED', {
            note: `provider transaction ${outcome.providerTransactionId}`,
            data: {
              providerTransactionId: outcome.providerTransactionId,
              providerStatusRaw: 'CONFIRMED',
              attempts: 0,
              nextAttemptAt: null,
            },
          }),
        );
        return true;

      case 'SUBMITTED':
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'PAYOUT_SUBMITTED', {
            note: `provider accepted ${outcome.providerTransactionId}`,
            data: {
              providerTransactionId: outcome.providerTransactionId,
              providerStatusRaw: 'SUBMITTED',
              attempts: 0,
              nextAttemptAt: this.clock.plusSeconds(30),
            },
          }),
        );
        return true;

      case 'REJECTED':
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'PAYOUT_FAILED', {
            note: `provider declined: ${outcome.code}`,
            data: {
              failureCode: outcome.code,
              failureMessage: outcome.message,
              providerTransactionId: outcome.providerTransactionId ?? null,
              providerStatusRaw: 'REJECTED',
            },
          }),
        );
        return true;

      case 'UNKNOWN':
      default:
        if (withdrawal.state === 'PAYOUT_UNCERTAIN') {
          // Already uncertain and still uncertain: record the attempt and wait,
          // rather than attempting an illegal transition onto itself.
          if (withdrawal.attempts + 1 >= MAX_STEP_ATTEMPTS) {
            await this.escalate(
              withdrawal,
              `The provider's outcome is still unknown after ${withdrawal.attempts + 1} probes`,
            );
            return true;
          }
          await this.prisma.inTransaction((tx) =>
            this.states.patch(tx, withdrawal, {
              attempts: { increment: 1 },
              nextAttemptAt: this.backoffDeadline(withdrawal.attempts),
            }),
          );
          return false;
        }
        await this.prisma.inTransaction((tx) =>
          this.states.transition(tx, withdrawal, 'PAYOUT_UNCERTAIN', {
            note: `provider outcome unknown: ${
              outcome.status === 'UNKNOWN' ? outcome.reason : outcome.status
            }`,
            data: {
              attempts: { increment: 1 },
              nextAttemptAt: this.backoffDeadline(withdrawal.attempts),
            },
          }),
        );
        return true;
    }
  }

  private async settle(withdrawal: Withdrawal): Promise<boolean> {
    await withSerializationRetry(() =>
      this.prisma.inSerializableTransaction(async (tx) => {
        await this.ledger.post(tx, withdrawalJournal.settlement(this.journalContext(withdrawal)));
        await this.states.transition(tx, withdrawal, 'COMPLETED', {
          note: 'payout settled',
          data: { nextAttemptAt: null, leaseUntil: null, leaseOwner: null },
        });
      }),
    );
    return true;
  }

  private async beginCompensation(withdrawal: Withdrawal): Promise<boolean> {
    await this.prisma.inTransaction((tx) =>
      this.states.transition(tx, withdrawal, 'COMPENSATING', {
        note: `returning ${withdrawal.grossMinor} to the driver's balance`,
        data: { attempts: 0 },
      }),
    );
    return true;
  }

  /**
   * Puts the money back on the driver's Yandex balance.
   *
   * The compensating credit gets its own idempotency token, derived from the
   * withdrawal's. Reusing the debit's token would be read by Yandex as a replay
   * of the debit and the credit would never be applied.
   */
  private async compensate(withdrawal: Withdrawal): Promise<boolean> {
    const gross = moneyOf(withdrawal.grossMinor, withdrawal.currency);
    const outcome = await this.yandex.createCredit({
      parkId: withdrawal.parkId,
      contractorProfileId: withdrawal.yandexContractorProfileId,
      amount: gross,
      categoryId: this.env.YANDEX_PAYOUT_CATEGORY_ID ?? 'partner_service_manual',
      description: `Cash Out reversal ${withdrawal.reference}`,
      idempotencyToken: `${withdrawal.yandexIdempotencyToken}-rev`,
    });

    if (outcome.status === 'APPLIED') {
      await withSerializationRetry(() =>
        this.prisma.inSerializableTransaction(async (tx) => {
          await this.ledger.post(
            tx,
            withdrawalJournal.compensation(
              this.journalContext(withdrawal),
              withdrawal.failureCode ?? 'payout_failed',
            ),
          );
          await this.states.transition(tx, withdrawal, 'REVERSED', {
            note: `compensating Yandex transaction ${outcome.transaction.id}`,
            data: { nextAttemptAt: null },
          });
        }),
      );
      return true;
    }

    if (withdrawal.attempts >= MAX_STEP_ATTEMPTS) {
      await this.escalate(
        withdrawal,
        `Could not return ${gross.toString()} to the driver's balance after ${withdrawal.attempts} attempts`,
      );
      return true;
    }

    await this.prisma.inTransaction((tx) =>
      this.states.patch(tx, withdrawal, {
        attempts: { increment: 1 },
        nextAttemptAt: this.backoffDeadline(withdrawal.attempts),
        failureMessage:
          outcome.status === 'REJECTED' ? outcome.message : `compensation ${outcome.reason}`,
      }),
    );
    return false;
  }

  // ------------------------------------------------------------------ helpers

  /** Hands the withdrawal to a human, with the reason recorded. */
  async escalate(withdrawal: Withdrawal, reason: string): Promise<void> {
    await this.prisma.inTransaction((tx) =>
      this.states.transition(tx, withdrawal, 'MANUAL_REVIEW', {
        note: reason,
        data: { manualReviewReason: reason, nextAttemptAt: null },
      }),
    );
    this.logger.warning('Withdrawal escalated to manual review', {
      withdrawalId: withdrawal.id,
      reason,
    });
  }

  private journalContext(withdrawal: Withdrawal): WithdrawalJournalContext {
    return {
      withdrawalId: withdrawal.id,
      driverId: withdrawal.driverId,
      parkId: withdrawal.parkId,
      gross: moneyOf(withdrawal.grossMinor, withdrawal.currency),
      platformFee: moneyOf(withdrawal.platformFeeMinor, withdrawal.currency),
      providerFee: moneyOf(withdrawal.providerFeeMinor, withdrawal.currency),
      net: moneyOf(withdrawal.netMinor, withdrawal.currency),
      providerAccountKey: this.provider.name,
    };
  }

  private backoffDeadline(attempts: number): Date {
    const seconds = Math.min(300, 5 * 2 ** Math.max(0, attempts));
    return this.clock.plusSeconds(seconds);
  }

  private async backOff(withdrawal: Withdrawal, message: string): Promise<void> {
    await this.prisma.withdrawal.updateMany({
      where: { id: withdrawal.id },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: this.backoffDeadline(withdrawal.attempts),
        failureMessage: message.slice(0, 500),
      },
    });
  }

  private async acquireLease(withdrawalId: string, owner: string): Promise<boolean> {
    const now = this.clock.now();
    const result = await this.prisma.withdrawal.updateMany({
      where: {
        id: withdrawalId,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        leaseOwner: owner,
        leaseUntil: this.clock.plusSeconds(this.env.WITHDRAWAL_LEASE_SECONDS),
      },
    });
    return result.count === 1;
  }

  private async releaseLease(withdrawalId: string, owner: string): Promise<void> {
    await this.prisma.withdrawal.updateMany({
      where: { id: withdrawalId, leaseOwner: owner },
      data: { leaseOwner: null, leaseUntil: null },
    });
  }
}

const TERMINAL = new Set<WithdrawalState>(['COMPLETED', 'REVERSED', 'FAILED', 'REJECTED']);
/** States whose next move comes from outside: a webhook, or a person. */
const WAITING = new Set<WithdrawalState>(['RISK_REVIEW', 'MANUAL_REVIEW']);

function moneyOf(minor: bigint, currency: string): Money {
  return Money.fromMinor(minor, currency as CurrencyCode);
}

export { TERMINAL as TERMINAL_STATES_SET, WAITING as WAITING_STATES_SET, moneyOf };
