import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Currency, Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TransactionHistoryQueryDto } from './dto/transaction-history-query.dto';
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
  ) {}

  async create(params: CreateTransactionParams, tx?: Tx) {
    const client = tx ?? this.prisma;
    return client.transaction.create({
      data: {
        userId: params.userId,
        partnerId: params.partnerId ?? undefined,
        type: params.type,
        status: TransactionStatus.INITIATED,
        amount: params.amount,
        currency: params.currency ?? Currency.AMD,
        bonusAppliedAmount: params.bonusAppliedAmount ?? 0,
        description: params.description,
        idempotencyKey: params.idempotencyKey,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  async findByIdempotencyKey(idempotencyKey: string) {
    return this.prisma.transaction.findUnique({ where: { idempotencyKey } });
  }

  async markCompleted(
    transactionId: string,
    extra: { bonusEarnedAmount?: Decimal | number | string } = {},
    tx?: Tx,
  ) {
    const client = tx ?? this.prisma;
    const updated = await client.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.COMPLETED,
        ...(extra.bonusEarnedAmount !== undefined
          ? { bonusEarnedAmount: extra.bonusEarnedAmount }
          : {}),
      },
    });

    // Emitted post-write; listeners (referral qualification, notifications,
    // analytics) are decoupled side effects, not part of the money-moving
    // transaction itself.
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
