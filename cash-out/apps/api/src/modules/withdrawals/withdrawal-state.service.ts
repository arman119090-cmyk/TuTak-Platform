import { Injectable } from '@nestjs/common';
import { Prisma, Withdrawal, WithdrawalState } from '@prisma/client';
import { assertTransition } from '@cashout/contracts';
import { TransactionClient } from '../../prisma/prisma.service';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';

export class WithdrawalConflictError extends Error {
  constructor(
    readonly withdrawalId: string,
    readonly expectedVersion: number,
  ) {
    super(
      `Withdrawal ${withdrawalId} changed underneath us (expected version ${expectedVersion})`,
    );
    this.name = 'WithdrawalConflictError';
  }
}

export interface TransitionOptions {
  readonly note?: string;
  readonly actorType?: 'SYSTEM' | 'ADMIN' | 'DRIVER' | 'PROVIDER';
  readonly actorId?: string;
  readonly metadata?: Prisma.InputJsonValue;
  /** Extra columns to set in the same statement as the state change. */
  readonly data?: Prisma.WithdrawalUncheckedUpdateManyInput;
}

/**
 * The only way a withdrawal's state ever changes.
 *
 * Three guarantees, all of which have to hold together:
 *
 *  1. **The transition is legal.** Checked against the shared state machine, so
 *     the API, the worker and an admin action all obey the same graph.
 *  2. **The write is conditional.** The UPDATE carries the version the caller
 *     read; if anything changed in between, zero rows match and the caller is
 *     told, rather than overwriting a decision someone else made. This is what
 *     makes two workers racing on the same withdrawal safe.
 *  3. **The history is written with it.** The event row is inserted in the same
 *     transaction, so there is no such thing as a state change without a record
 *     of who made it and why.
 */
@Injectable()
export class WithdrawalStateService {
  constructor(
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  async transition(
    tx: TransactionClient,
    current: Pick<Withdrawal, 'id' | 'state' | 'version'>,
    to: WithdrawalState,
    options: TransitionOptions = {},
  ): Promise<Withdrawal> {
    assertTransition(current.state, to);

    const timestamps = timestampsFor(to, this.clock.now());
    const result = await tx.withdrawal.updateMany({
      where: { id: current.id, version: current.version, state: current.state },
      data: {
        ...options.data,
        ...timestamps,
        state: to,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new WithdrawalConflictError(current.id, current.version);
    }

    await tx.withdrawalEvent.create({
      data: {
        withdrawalId: current.id,
        fromState: current.state,
        toState: to,
        note: options.note ?? null,
        actorType: options.actorType ?? 'SYSTEM',
        actorId: options.actorId ?? null,
        metadata: options.metadata ?? Prisma.DbNull,
      },
    });

    this.logger.info('Withdrawal transitioned', {
      withdrawalId: current.id,
      from: current.state,
      to,
      note: options.note,
    });

    return tx.withdrawal.findUniqueOrThrow({ where: { id: current.id } });
  }

  /** Updates columns without changing state; still version-guarded. */
  async patch(
    tx: TransactionClient,
    current: Pick<Withdrawal, 'id' | 'version'>,
    data: Prisma.WithdrawalUncheckedUpdateManyInput,
  ): Promise<void> {
    const result = await tx.withdrawal.updateMany({
      where: { id: current.id, version: current.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new WithdrawalConflictError(current.id, current.version);
    }
  }
}

function timestampsFor(to: WithdrawalState, now: Date): Prisma.WithdrawalUncheckedUpdateManyInput {
  switch (to) {
    case 'RESERVED':
      return { reservedAt: now };
    case 'PAYOUT_SUBMITTED':
      return { submittedAt: now };
    case 'PAYOUT_CONFIRMED':
      return { confirmedAt: now };
    case 'COMPLETED':
    case 'REVERSED':
    case 'FAILED':
    case 'REJECTED':
      return { completedAt: now };
    default:
      return {};
  }
}
