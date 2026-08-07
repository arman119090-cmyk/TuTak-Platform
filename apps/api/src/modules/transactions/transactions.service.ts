import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Currency, Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseMoney } from '../../common/utils/money';
import { TransactionHistoryQueryDto } from './dto/transaction-history-query.dto';
import { OutboxService } from '../ledger/outbox.service';
import { TransactionCompletedEvent } from './events/transaction-completed.event';

type Tx = Prisma.TransactionClient;

export interface CreateTransactionParams {
  userId: string;
  partnerId?: string | null;
  type: TransactionType;
  amount: Decimal | number | string;
  currency?: Currency;
  bonusAppliedAmount?: Decimal | number | string;
  description?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly outbox: OutboxService,
  ) {}

  async create(params: CreateTransactionParams, tx?: Tx) {
    const client = tx ?? this.prisma;
    // Re-validate at the persistence boundary: no caller, internal or
    // external, may write a negative or malformed monetary value.
    const amount = parseMoney(params.amount, 'transaction amount');
    const bonusApplied = parseMoney(params.bonusAppliedAmount ?? 0, 'bonusAppliedAmount');

    return client.transaction.create({
      data: {
        userId: params.userId,
        partnerId: params.partnerId ?? undefined,
        type: params.type,
        status: TransactionStatus.INITIATED,
        amount,
        currency: params.currency ?? Currency.AMD,
        bonusAppliedAmount: bonusApplied,
        description: params.description,
        idempotencyKey: params.idempotencyKey,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Idempotency keys are namespaced per user. Looking one up globally
   * allowed cross-account disclosure and let an attacker squat a key so a
   * victim's later payment silently became a no-op (audit §B3).
   */
  async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.prisma.transaction.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  /**
   * Marks a transaction complete and records the event durably.
   *
   * The event used to be an in-process emit after the write. That is
   * fire-and-forget: a process death between the update and the listener lost
   * the referral reward silently, and nothing ever noticed
   * (docs/AUDIT_FINAL_2026-08.md H-2). The outbox row is now written in the
   * same transaction as the status change, so the event exists if and only if
   * the transaction completed, and a drainer delivers it whenever the process
   * comes back.
   *
   * The in-process emit is kept alongside it, deliberately: it is what makes
   * notifications feel instant, and it is now an optimisation rather than the
   * only delivery path. If it is missed, the outbox still delivers.
   */
  async markCompleted(
    transactionId: string,
    extra: { bonusEarnedAmount?: Decimal | number | string } = {},
    tx?: Tx,
  ) {
    const client = tx ?? this.prisma;

    const write = async (inner: Tx) => {
      const updated = await inner.transaction.update({
        where: { id: transactionId },
        data: {
          status: TransactionStatus.COMPLETED,
          ...(extra.bonusEarnedAmount !== undefined
            ? { bonusEarnedAmount: extra.bonusEarnedAmount }
            : {}),
        },
      });

      await this.outbox.publish(inner, {
        aggregateType: 'Transaction',
        aggregateId: updated.id,
        eventType: 'transaction.completed',
        payload: {
          transactionId: updated.id,
          userId: updated.userId,
          partnerId: updated.partnerId,
          type: updated.type,
          amount: updated.amount.toString(),
        },
      });

      return updated;
    };

    const updated = tx ? await write(tx) : await this.prisma.$transaction(write);

    this.events.emit('transaction.completed', {
      transactionId: updated.id,
      userId: updated.userId,
      partnerId: updated.partnerId,
      type: updated.type,
      amount: updated.amount.toString(),
    } satisfies TransactionCompletedEvent);

    return updated;
  }

  async markFailed(transactionId: string, reason: string, tx?: Tx) {
    const client = tx ?? this.prisma;
    return client.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.FAILED, metadata: { failureReason: reason } },
    });
  }

  async markFlagged(transactionId: string, reason: string, tx?: Tx) {
    const client = tx ?? this.prisma;
    return client.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.FLAGGED, metadata: { flagReason: reason } },
    });
  }

  async history(query: TransactionHistoryQueryDto) {
    const where: Prisma.TransactionWhereInput = {
      userId: query.userId,
      partnerId: query.partnerId,
      type: query.type,
      status: query.status,
      createdAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
    };

    const items = await this.prisma.transaction.findMany({
      where,
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });

    return {
      items,
      nextCursor: items.length === query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
