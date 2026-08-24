import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Currency, LedgerAccountType, Prisma, PostingDirection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, Money, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';

export interface RecordCollectionParams {
  partnerId: string;
  amount: Money;
  currency?: Currency;
  /** The partner's own bank transfer reference, from the statement. */
  bankReference: string;
  /** The admin recording this; scopes the idempotency key and is recorded. */
  actorId: string;
  idempotencyKey: string;
}

export interface CollectionResult {
  collectionId: string;
  amount: string;
  /** What the partner still owes after this collection, as a positive figure. */
  remainingOwed: string;
}

/** Same narrowing as `payout-engine.service.ts`'s copy — see there for why. */
function isKeyCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes('idempotencyKey'));
}

/**
 * Records a partner's bank transfer settling a debt to TuTak — the missing
 * direction of `PayoutEngineService`.
 *
 * Doc §2/§7: a purchase posts two obligations into the same `PARTNER_PAYABLE`
 * account at once — TuTak's compensation for the discount the partner gave,
 * and the partner's commission on the sale. Most of the time the first
 * exceeds the second and the balance sits negative (TuTak owes the partner,
 * see `PayoutEngineService`). It can go the other way — heavy bonus
 * redemption against a partner with a high commission rate, or a refund
 * clawing back a payout that already drained the balance (see
 * `RefundEngineService.warnIfPartnerNowOwesUs`) — and then the raw balance
 * is positive: the partner owes TuTak.
 *
 * This is the settlement half that closes that debt. Deliberately single-step
 * (see the model's own docblock for why), and deliberately *not* behind the
 * two-person rule `PayoutEngineService.confirmPaid` enforces: that control
 * exists because a single compromised admin session can otherwise drain a
 * partner's balance to an external account and mark the theft settled, with
 * every record agreeing it was legitimate. Recording an inbound transfer
 * moves nothing external — a bad or fabricated entry here misstates the
 * books (a real problem, which is why it is audited and permission-gated the
 * same as a payout) but does not, on its own, let one admin move a single
 * dram out of the platform. The threat model that justifies a second
 * approver on the way out does not apply on the way in.
 *
 * Same discipline as `PayoutEngineService` regardless: idempotent via
 * `IdempotencyService` with a durable fallback lookup, a `FOR UPDATE` lock
 * on the account row so two concurrent collections cannot together overdraw
 * what the partner actually owes, and one balanced ledger posting per
 * collection inside the same transaction as the row that describes it.
 */
@Injectable()
export class PartnerCollectionService {
  private readonly logger = new Logger(PartnerCollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** What this partner currently owes TuTak, as a non-negative figure. */
  async amountOwed(partnerId: string, currency: Currency = Currency.AMD): Promise<Decimal> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId, currency },
    });
    if (!account) return new Decimal(0);
    // Credit-normal: TuTak owing the partner is negative. A partner owing
    // TuTak is the unusual, positive case — and the only one this reports;
    // the ordinary case reports zero rather than a negative "amount owed".
    const raw = new Decimal(account.balance);
    return raw.greaterThan(0) ? raw : new Decimal(0);
  }

  async record(params: RecordCollectionParams): Promise<CollectionResult> {
    const amount = parsePositiveMoney(params.amount, 'collection amount');
    const currency = params.currency ?? Currency.AMD;
    const bankReference = params.bankReference.trim();
    if (!bankReference) {
      throw new BadRequestException('A bank reference is required');
    }

    // Existence check only — unlike a payout, an inactive or payout-blocked
    // partner can still pay down what they owe; refusing that would make
    // recovering the money strictly harder for exactly the partners most
    // likely to owe it.
    await this.prisma.partner.findUniqueOrThrow({ where: { id: params.partnerId } });

    return this.idempotency.run<CollectionResult>(
      {
        scope: `partner-collection:${params.actorId}`,
        key: params.idempotencyKey,
        request: { partnerId: params.partnerId, amount: amount.toString(), currency, bankReference },
      },
      () =>
        this.execute(
          params.partnerId,
          amount,
          currency,
          bankReference,
          params.actorId,
          params.idempotencyKey,
        ),
    );
  }

  private async execute(
    partnerId: string,
    amount: Decimal,
    currency: Currency,
    bankReference: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<CollectionResult> {
    // Same reasoning as `PayoutEngineService.executePayout`: the
    // `IdempotencyRecord` this call is wrapped in can itself be lost between
    // its own two transactions, and a retry without this check would record
    // the same bank transfer twice.
    const already = await this.findByKey(actorId, idempotencyKey);
    if (already) return this.toResult(already, currency);

    const [partnerAccount, bankAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId, currency }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_BANK, currency }),
    ]);

    let collection;
    try {
      collection = await this.prisma.$transaction(async (tx) => {
        // Locks the same row `ledger.post` below moves, for the same reason
        // `requestPayout` does: a conditional UPDATE here would race the
        // posting's own balance move and double-count. See that method's
        // docblock for the full argument.
        const locked = await tx.$queryRaw<Array<{ balance: string }>>`
          SELECT balance FROM "ledger_accounts" WHERE id = ${partnerAccount.id} FOR UPDATE
        `;

        const owed = new Decimal(locked[0]?.balance ?? 0);
        if (amount.greaterThan(owed)) {
          throw new ConflictException(
            `Collection of ${amount.toString()} exceeds the ${Decimal.max(owed, 0).toString()} ` +
              'this partner actually owes',
          );
        }

        const created = await tx.partnerCollection.create({
          data: {
            partnerId,
            amount,
            currency,
            bankReference,
            recordedByUserId: actorId,
            idempotencyKey,
          },
        });

        const ledgerTransaction = await this.ledger.post(
          {
            kind: 'partner.collection.recorded',
            sourceType: 'PartnerCollection',
            sourceId: created.id,
            currency,
            postings: [
              { accountId: bankAccount.id, direction: PostingDirection.DEBIT, amount },
              { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount },
            ],
            events: [
              {
                aggregateType: 'PartnerCollection',
                aggregateId: created.id,
                eventType: 'partner.collection.recorded',
                payload: { collectionId: created.id, partnerId, amount: amount.toString() },
              },
            ],
          },
          tx,
        );

        // Same clock a confirmed payout sets — see `Partner.lastSettledAt`.
        // Either direction of a real settlement resets the biweekly-check
        // sweep's window for this partner.
        await tx.partner.update({ where: { id: partnerId }, data: { lastSettledAt: new Date() } });

        return tx.partnerCollection.update({
          where: { id: created.id },
          data: { ledgerTransactionId: ledgerTransaction.id },
        });
      });
    } catch (err) {
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(actorId, idempotencyKey);
        if (existing) return this.toResult(existing, currency);
      }
      throw err;
    }

    const remaining = await this.amountOwed(partnerId, currency);
    this.logger.log(
      `Collection ${collection.id} recorded: ${amount.toString()} from partner ${partnerId}`,
    );

    return {
      collectionId: collection.id,
      amount: amount.toFixed(MONEY_SCALE),
      remainingOwed: remaining.toFixed(MONEY_SCALE),
    };
  }

  private findByKey(actorId: string, idempotencyKey: string) {
    return this.prisma.partnerCollection.findUnique({
      where: { recordedByUserId_idempotencyKey: { recordedByUserId: actorId, idempotencyKey } },
    });
  }

  private async toResult(
    collection: { id: string; amount: Decimal; partnerId: string },
    currency: Currency,
  ): Promise<CollectionResult> {
    const remaining = await this.amountOwed(collection.partnerId, currency);
    return {
      collectionId: collection.id,
      amount: collection.amount.toFixed(MONEY_SCALE),
      remainingOwed: remaining.toFixed(MONEY_SCALE),
    };
  }

  /** A partner's collection history, newest first — mirrors `listForPartner` on payouts. */
  async listForPartner(partnerId: string, limit = 30) {
    const collections = await this.prisma.partnerCollection.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const actorIds = [...new Set(collections.map((c) => c.recordedByUserId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameOf = new Map(actors.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    return collections.map((c) => ({
      ...c,
      recordedByName: c.recordedByUserId ? (nameOf.get(c.recordedByUserId) ?? c.recordedByUserId) : null,
    }));
  }
}
