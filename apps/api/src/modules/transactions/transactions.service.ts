import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Currency, Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseMoney } from '../../common/utils/money';
import { TransactionHistoryQueryDto } from './dto/transaction-history-query.dto';
import { OutboxService } from '../ledger/outbox.service';
import { TransactionCompletedEvent } from './events/transaction-completed.event';
import { MediaViewService } from '../media/media-view.service';

type Tx = Prisma.TransactionClient;

export interface CreateTransactionParams {
  userId: string;
  partnerId?: string | null;
  /**
   * Which branch of `partnerId` this happened at, where that is known.
   *
   * Passed by the purchase-intent flow, which is the only writer that has a
   * branch to record. Every other caller — legacy partner-wide QR, EV
   * sessions, CDR reconciliation, roaming — leaves it undefined, and those
   * rows stay branch-less exactly as they are today.
   */
  partnerBranchId?: string | null;
  type: TransactionType;
  amount: Decimal | number | string;
  currency?: Currency;
  bonusAppliedAmount?: Decimal | number | string;
  description?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  /**
   * The partner brand this operation should be recorded under — spec §2.2.
   *
   * Almost never passed. Left undefined (the normal case) the snapshot is
   * taken from the partner as it stands *right now*, which is correct for
   * every operation that is happening now. It is passed explicitly by exactly
   * one kind of caller: a refund or reversal, which must carry the brand of
   * the operation it reverses rather than today's — spec §2.2's "a
   * refund/reversal must resolve to the source operation's snapshot".
   *
   * Display-only either way. Nothing financial reads these two columns.
   */
  brand?: { displayName: string; logoAssetId: string | null } | null;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly outbox: OutboxService,
    private readonly media: MediaViewService,
  ) {}

  async create(params: CreateTransactionParams, tx?: Tx) {
    const client = tx ?? this.prisma;
    // Re-validate at the persistence boundary: no caller, internal or
    // external, may write a negative or malformed monetary value.
    const amount = parseMoney(params.amount, 'transaction amount');
    const bonusApplied = parseMoney(params.bonusAppliedAmount ?? 0, 'bonusAppliedAmount');
    const brand = await this.resolveBrandSnapshot(client, params);

    return client.transaction.create({
      data: {
        userId: params.userId,
        partnerId: params.partnerId ?? undefined,
        partnerBranchId: params.partnerBranchId ?? undefined,
        brandDisplayName: brand?.displayName ?? null,
        brandLogoAssetId: brand?.logoAssetId ?? null,
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
   * The brand to stamp on a new transaction.
   *
   * One read, inside whatever transaction the caller is already in, and it
   * cannot fail the write: a partner row that has somehow gone missing yields
   * a null snapshot rather than an exception, because a display column must
   * never be the reason a financial record fails to persist.
   */
  private async resolveBrandSnapshot(
    client: Tx | PrismaService,
    params: CreateTransactionParams,
  ): Promise<{ displayName: string; logoAssetId: string | null } | null> {
    if (params.brand !== undefined) return params.brand;
    if (!params.partnerId) return null;
    const partner = await client.partner.findUnique({
      where: { id: params.partnerId },
      select: { displayName: true, logoAssetId: true },
    });
    return partner ? { displayName: partner.displayName, logoAssetId: partner.logoAssetId } : null;
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

  /**
   * `branchIds` is `branchFilterFor`'s answer for the caller, and is
   * deliberately a separate argument rather than a field on
   * `TransactionHistoryQueryDto`: the DTO is bound from client-supplied
   * query parameters, so an authorization filter living there could be
   * widened by the very caller it restricts. `null` means unrestricted (a
   * customer reading their own history, an owner, an admin, an all-branch
   * manager).
   *
   * A restricted caller does not see branch-less rows. Legacy partner-wide
   * QR, EV sessions, CDR reconciliation and roaming record no branch, and
   * `{ in: [...] }` excludes null — which is the safe direction, and the
   * same one `PurchaseIntent` scoping already takes.
   */
  async history(query: TransactionHistoryQueryDto, branchIds: string[] | null = null) {
    const where: Prisma.TransactionWhereInput = {
      userId: query.userId,
      partnerId: query.partnerId,
      ...(branchIds === null ? {} : { partnerBranchId: { in: branchIds } }),
      type: query.type,
      status: query.status,
      createdAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
    };

    const items = await this.prisma.transaction.findMany({
      where,
      // Exactly the fields `TransactionDto` declares, and no others.
      //
      // This used to return the row. Two endpoints read it — a customer's own
      // history, and the list a merchant sees for their partner, which is
      // other people's transactions. Both were getting `idempotencyKey`,
      // which is a control identifier for replaying a request and is of no
      // use to either of them. Keys are scoped to the owning user
      // (`@@unique([userId, idempotencyKey])`), so a merchant holding a
      // customer's key cannot replay it — the containment is in the schema,
      // not in this query, and handing it out anyway is gratuitous.
      //
      // The lasting reason for the projection is the next column. `select`
      // means a field added to the model reaches a client only when somebody
      // decides it should; `findMany` without one means the default is
      // publication, and nothing fails when that default is wrong.
      select: {
        id: true,
        userId: true,
        partnerId: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        bonusAppliedAmount: true,
        bonusEarnedAmount: true,
        description: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        // Spec §1.3/§2.2: every customer-facing operation row shows who the
        // customer was dealing with, as *that operation* recorded it.
        brandDisplayName: true,
        brandLogoAssetId: true,
      },
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });

    // One batched resolution for the whole page rather than two queries per
    // row — see `MediaViewService.brandsFor`.
    const brands = await this.media.brandsFor(items);

    return {
      items: items.map((item) => {
        const { brandDisplayName: _name, brandLogoAssetId: _asset, ...row } = item;
        return { ...row, partnerBrand: brands.get(item) ?? null };
      }),
      nextCursor: items.length === query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * How many completed purchases this customer has made in each partner
   * category — the raw signal `PartnersService` turns into "recommended for
   * you" on the nearby-branches list (2026-08-26). Only real, settled money
   * movement counts: `QR_PAYMENT` (the legacy synchronous redeem) and
   * `PARTNER_PURCHASE` (the current confirm-flow) once `COMPLETED` — never
   * `INITIATED`/`PENDING` (nothing happened yet), never `FAILED`/`REVERSED`
   * (it didn't stick), and never bonus/EV/referral rows, which say nothing
   * about which *category of shop* this person actually spends in.
   *
   * A join+group-by through the related `Partner.category`, which Prisma's
   * query builder cannot express directly — `$queryRaw` rather than
   * `groupBy` for that reason. Ordered richest-first so a caller taking the
   * top few needs no further sorting.
   */
  async completedPurchaseCategoryCounts(userId: string): Promise<Array<{ category: string; count: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ category: string; count: bigint }>>`
      SELECT p.category AS category, COUNT(*)::bigint AS count
      FROM "transactions" t
      JOIN "partners" p ON p.id = t."partnerId"
      WHERE t."userId" = ${userId}
        AND t.status = 'COMPLETED'
        AND t.type IN ('QR_PAYMENT', 'PARTNER_PURCHASE')
      GROUP BY p.category
      ORDER BY count DESC
    `;
    return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
  }
}
