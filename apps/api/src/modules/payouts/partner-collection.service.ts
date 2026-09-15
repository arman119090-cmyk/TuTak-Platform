import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  CollectionStatus,
  Currency,
  LedgerAccountType,
  Prisma,
  PostingDirection,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { normalizeBankTransactionId } from '../../common/utils/bank-reference';
import { MONEY_SCALE, Money, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';

export interface RecordCollectionParams {
  partnerId: string;
  amount: Money;
  currency?: Currency;
  /** The partner's own bank transfer reference, from the statement. */
  bankReference: string;
  /**
   * The bank statement's own external transaction id — the uniqueness key.
   * Normalized (trim, strip internal whitespace, uppercase) before it is
   * compared or stored — see `normalizeBankTransactionId`.
   */
  bankTransactionId: string;
  /**
   * The invoice/фактура number this transfer was billed against, if there is
   * one — free text, purely for reconciliation. Optional: TuTak does not
   * generate or store invoices itself, so not every collection has one.
   */
  invoiceReference?: string;
  /** The admin recording this; scopes the idempotency key and is recorded. */
  actorId: string;
  idempotencyKey: string;
}

export interface CollectionResult {
  collectionId: string;
  amount: string;
  status: CollectionStatus;
  /**
   * What the partner still owes after this call, as a positive figure. When
   * the collection is `PENDING`, nothing has posted yet, so this is simply
   * the balance as it stands right now — not a preview of what confirming
   * will produce, since the balance can move before that happens.
   */
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
 * Did this come from the (currency, bankTransactionId) unique index —
 * Problem 1's database-level control?
 *
 * Narrow for the same reason `isKeyCollision` is: a blanket "P2002 means
 * already done" would swallow a collision on `ledgerTransactionId` too,
 * which is a real bug, not a duplicate submission.
 */
function isBankTransactionCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes('bankTransactionId'));
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
 * This is the settlement half that closes that debt.
 *
 * ── Two controls, two different threats ─────────────────────────────────
 *
 * Problem 1 — a fabricated or duplicated collection. `bankTransactionId` is
 * the bank statement's own external transaction id, unique per
 * (currency, bankTransactionId) at the database level (see the schema and
 * its migration) — the same real transfer can never be recorded twice, by
 * the same admin or a different one, under the same idempotency key or a
 * fresh one. `bankReference` stays a free-text label; it was never the
 * uniqueness key even before this pass, and still isn't.
 *
 * Problem 2 — maker-checker. When `payouts.dualControl` is on, `record`
 * creates a `PENDING` row only: no ledger posting, no balance change. A
 * *different* admin must call `confirm` before anything posts — mirroring
 * `PayoutEngineService.requestPayout`/`confirmPaid` as closely as the domain
 * allows. This is new, and deliberately not the same reasoning the original
 * single-step design rested on ("recording an inbound transfer moves nothing
 * external, so one admin cannot drain a balance to a bank account the way a
 * payout could"). That reasoning is still true — this control exists for a
 * different threat: one admin fabricating or duplicating a collection still
 * *understates what a partner owes*, silently and in the partner's favor,
 * which is exactly as real a financial-control defect as an unauthorised
 * payout, just pointed the other way.
 *
 * When `payouts.dualControl` is off, `record` posts immediately — the
 * original single-step design, preserved exactly, with Problem 1's
 * uniqueness control and the existing idempotency guarantee still fully
 * enforced regardless. This is a deliberate divergence from `Payout`, which
 * always requires a separate confirm call and only toggles the self-check;
 * a collection has no realistic in-flight moment to confirm later — an
 * operator either has a bank statement in front of them or does not — so
 * "dual control off" here means "back to one step," not "confirm is
 * optional."
 *
 * Same discipline as `PayoutEngineService` throughout: idempotent via
 * `IdempotencyService` with a durable fallback lookup, a `FOR UPDATE` lock
 * on the account row so two concurrent collections (or a collection and a
 * confirmation) cannot together overdraw what the partner actually owes, and
 * one balanced ledger posting per collection inside the same transaction as
 * the row that describes it.
 */
@Injectable()
export class PartnerCollectionService {
  private readonly logger = new Logger(PartnerCollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
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
    const bankTransactionId = normalizeBankTransactionId(params.bankTransactionId);

    // Existence check only — unlike a payout, an inactive or payout-blocked
    // partner can still pay down what they owe; refusing that would make
    // recovering the money strictly harder for exactly the partners most
    // likely to owe it.
    await this.prisma.partner.findUniqueOrThrow({ where: { id: params.partnerId } });

    const dualControl = this.config.get('payouts.dualControl', { infer: true });

    return this.idempotency.run<CollectionResult>(
      {
        scope: `partner-collection:${params.actorId}`,
        key: params.idempotencyKey,
        request: {
          partnerId: params.partnerId,
          amount: amount.toString(),
          currency,
          bankReference,
          bankTransactionId,
        },
      },
      () =>
        dualControl
          ? this.executePending(
              params.partnerId,
              amount,
              currency,
              bankReference,
              bankTransactionId,
              params.invoiceReference,
              params.actorId,
              params.idempotencyKey,
            )
          : this.executeSingleStep(
              params.partnerId,
              amount,
              currency,
              bankReference,
              bankTransactionId,
              params.invoiceReference,
              params.actorId,
              params.idempotencyKey,
            ),
    );
  }

  /** Problem 2, maker step: a PENDING row only — nothing posts yet. */
  private async executePending(
    partnerId: string,
    amount: Decimal,
    currency: Currency,
    bankReference: string,
    bankTransactionId: string,
    invoiceReference: string | undefined,
    actorId: string,
    idempotencyKey: string,
  ): Promise<CollectionResult> {
    const already = await this.findByKey(actorId, idempotencyKey);
    if (already) return this.toResult(already);

    // Best-effort only — not under lock, and not authoritative. The
    // authoritative check happens in `confirm`, under a row lock, at the
    // moment the amount is actually claimed; the balance can move in either
    // direction between now and then. This exists purely so an obviously
    // wrong entry is rejected immediately rather than sitting PENDING for a
    // second admin to discover it is bad.
    const owed = await this.amountOwed(partnerId, currency);
    if (amount.greaterThan(owed)) {
      throw new ConflictException(
        `Collection of ${amount.toString()} exceeds the ${owed.toString()} this partner ` +
          'currently appears to owe. (Re-checked again, under lock, at confirmation.)',
      );
    }

    let collection;
    try {
      collection = await this.prisma.partnerCollection.create({
        data: {
          partnerId,
          amount,
          currency,
          bankReference,
          bankTransactionId,
          invoiceReference,
          status: CollectionStatus.PENDING,
          recordedByUserId: actorId,
          idempotencyKey,
        },
      });
    } catch (err) {
      if (isBankTransactionCollision(err)) {
        throw new ConflictException(
          'This bank transaction has already been recorded against a collection',
        );
      }
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(actorId, idempotencyKey);
        if (existing) return this.toResult(existing);
      }
      throw err;
    }

    this.logger.log(
      `Collection ${collection.id} recorded PENDING: ${amount.toString()} from partner ${partnerId}`,
    );
    return this.toResult(collection);
  }

  /** Dual control off: the original single-step design, unchanged in shape. */
  private async executeSingleStep(
    partnerId: string,
    amount: Decimal,
    currency: Currency,
    bankReference: string,
    bankTransactionId: string,
    invoiceReference: string | undefined,
    actorId: string,
    idempotencyKey: string,
  ): Promise<CollectionResult> {
    // Same reasoning as `PayoutEngineService.executePayout`: the
    // `IdempotencyRecord` this call is wrapped in can itself be lost between
    // its own two transactions, and a retry without this check would record
    // the same bank transfer twice.
    const already = await this.findByKey(actorId, idempotencyKey);
    if (already) return this.toResult(already);

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
            bankTransactionId,
            invoiceReference,
            status: CollectionStatus.CONFIRMED,
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

        // `Partner.lastSettledAt` is not touched here — see that column's
        // own docblock. `LedgerService.post` above already handled it if
        // this posting crossed the balance through zero.

        return tx.partnerCollection.update({
          where: { id: created.id },
          data: { ledgerTransactionId: ledgerTransaction.id },
        });
      });
    } catch (err) {
      if (isBankTransactionCollision(err)) {
        throw new ConflictException(
          'This bank transaction has already been recorded against a collection',
        );
      }
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(actorId, idempotencyKey);
        if (existing) return this.toResult(existing);
      }
      throw err;
    }

    this.logger.log(
      `Collection ${collection.id} recorded CONFIRMED (single-step): ${amount.toString()} from partner ${partnerId}`,
    );
    return this.toResult(collection);
  }

  /**
   * Problem 2, checker step. A different admin than the one who recorded
   * `collectionId` confirms it, atomically posting the ledger transaction
   * that actually reduces what the partner owes.
   *
   * Mirrors `PayoutEngineService.confirmPaid`: the claim (`updateMany` on
   * `status: PENDING`) and the posting share one transaction, so a repeated
   * confirmation cannot double-post — the second call finds `count === 0`
   * and posts nothing, having claimed nothing. The amount owed is re-checked
   * under the same `FOR UPDATE` lock the posting itself uses, because the
   * balance this collection was checked against at record time can have
   * moved since — a second collection, a purchase, a refund, anything that
   * touches this partner's `PARTNER_PAYABLE` account.
   *
   * The audit record is written inside this same transaction, not by the
   * controller afterwards the way `PayoutEngineService.confirmPaid`'s own
   * caller does it. That is a deliberate divergence from the mirrored
   * precedent: a controller-level failure between this call returning and
   * the controller's own `audit.record` call would otherwise leave a posted
   * collection with no audit trail, and a client retry of that same HTTP
   * request would otherwise be able to reach the controller's audit call
   * twice for one collection (the service call itself is already
   * safe to retry — the claim below simply finds nothing left to claim).
   */
  async confirm(collectionId: string, confirmedByUserId: string): Promise<CollectionResult> {
    const collection = await this.prisma.partnerCollection.findUniqueOrThrow({
      where: { id: collectionId },
    });
    if (collection.status !== CollectionStatus.PENDING) {
      throw new BadRequestException(`Collection is already ${collection.status}`);
    }

    // ── Two-person rule ──────────────────────────────────────────────────
    // Same shape as `PayoutEngineService.confirmPaid`'s own check — see
    // there for the full reasoning. Skipped when there is no recorded maker
    // to differ from, and when `payouts.dualControl` is off, for the same
    // reasons that check is conditional there.
    if (
      this.config.get('payouts.dualControl', { infer: true }) &&
      collection.recordedByUserId &&
      collection.recordedByUserId === confirmedByUserId
    ) {
      throw new ForbiddenException(
        'This collection must be confirmed by someone other than the person who recorded it',
      );
    }

    const currency = collection.currency;
    const [partnerAccount, bankAccount] = await Promise.all([
      this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId: collection.partnerId,
        currency,
      }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_BANK, currency }),
    ]);

    await this.prisma.$transaction(async (tx) => {
      // Claim first, exactly like `confirmPaid`: the claim and the posting
      // share this transaction, so a collection can never end up CONFIRMED
      // without the ledger posting having happened, or the reverse. Two
      // concurrent confirmations: one claims, the other finds count === 0.
      const claimed = await tx.partnerCollection.updateMany({
        where: { id: collectionId, status: CollectionStatus.PENDING },
        data: {
          status: CollectionStatus.CONFIRMED,
          confirmedByUserId,
          confirmedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This collection was already resolved');
      }

      // Re-check under lock: the balance this was checked against at record
      // time can have moved since, in either direction.
      const locked = await tx.$queryRaw<Array<{ balance: string }>>`
        SELECT balance FROM "ledger_accounts" WHERE id = ${partnerAccount.id} FOR UPDATE
      `;
      const owed = new Decimal(locked[0]?.balance ?? 0);
      if (collection.amount.greaterThan(owed)) {
        throw new ConflictException(
          `Collection of ${collection.amount.toString()} exceeds the ` +
            `${Decimal.max(owed, 0).toString()} this partner currently owes`,
        );
      }

      const ledgerTransaction = await this.ledger.post(
        {
          kind: 'partner.collection.confirmed',
          sourceType: 'PartnerCollection',
          sourceId: collectionId,
          currency,
          postings: [
            { accountId: bankAccount.id, direction: PostingDirection.DEBIT, amount: collection.amount },
            { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: collection.amount },
          ],
          events: [
            {
              aggregateType: 'PartnerCollection',
              aggregateId: collectionId,
              eventType: 'partner.collection.confirmed',
              payload: {
                collectionId,
                partnerId: collection.partnerId,
                amount: collection.amount.toString(),
              },
            },
          ],
        },
        tx,
      );

      await tx.partnerCollection.update({
        where: { id: collectionId },
        data: { ledgerTransactionId: ledgerTransaction.id },
      });

      await this.audit.record(
        {
          actorUserId: confirmedByUserId,
          action: AuditAction.PARTNER_COLLECTION_CONFIRMED,
          entityType: 'PartnerCollection',
          entityId: collectionId,
          metadata: {
            partnerId: collection.partnerId,
            amount: collection.amount.toFixed(MONEY_SCALE),
            recordedByUserId: collection.recordedByUserId,
            remainingOwed: Decimal.max(owed.minus(collection.amount), 0).toFixed(MONEY_SCALE),
          },
        },
        tx,
      );

      // `Partner.lastSettledAt` is not touched here either — `ledger.post`
      // above already did, if this posting crossed the balance through zero.
    });

    this.logger.log(`Collection ${collectionId} confirmed by ${confirmedByUserId}`);

    const stored = await this.prisma.partnerCollection.findUniqueOrThrow({
      where: { id: collectionId },
    });
    return this.toResult(stored);
  }

  private findByKey(actorId: string, idempotencyKey: string) {
    return this.prisma.partnerCollection.findUnique({
      where: { recordedByUserId_idempotencyKey: { recordedByUserId: actorId, idempotencyKey } },
    });
  }

  private async toResult(collection: {
    id: string;
    amount: Decimal;
    partnerId: string;
    currency: Currency;
    status: CollectionStatus;
  }): Promise<CollectionResult> {
    const remaining = await this.amountOwed(collection.partnerId, collection.currency);
    return {
      collectionId: collection.id,
      amount: collection.amount.toFixed(MONEY_SCALE),
      status: collection.status,
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

    const actorIds = [
      ...new Set(
        collections
          .flatMap((c) => [c.recordedByUserId, c.confirmedByUserId])
          .filter((id): id is string => !!id),
      ),
    ];
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
      confirmedByName: c.confirmedByUserId
        ? (nameOf.get(c.confirmedByUserId) ?? c.confirmedByUserId)
        : null,
    }));
  }
}
