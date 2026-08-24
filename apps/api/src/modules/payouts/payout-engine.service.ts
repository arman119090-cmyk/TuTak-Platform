import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Currency,
  LedgerAccountType,
  PayoutStatus,
  PostingDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { MONEY_SCALE, Money, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';

export interface RequestPayoutParams {
  partnerId: string;
  amount: Money;
  currency?: Currency;
  /** The admin requesting this; scopes the idempotency key and is recorded. */
  actorId: string;
  idempotencyKey: string;
}

export interface PayoutResult {
  payoutId: string;
  amount: string;
  status: PayoutStatus;
  /** The partner's remaining payable balance after this payout. */
  remainingBalance: string;
}

/**
 * Moves a partner's earned balance to their bank.
 *
 * `PARTNER_PAYABLE` is a credit-normal account, so what the platform owes a
 * partner is a *negative* materialized balance (see ledger.int-spec.ts — the
 * sign carries the posting direction, not the sentiment). A payout debits
 * that account, moving the balance toward zero, and credits `BANK_CLEARING`,
 * where the money sits until the bank confirms. Two-step rather than
 * straight out of the ledger, because a transfer in flight is neither the
 * partner's to request again nor safe to call gone.
 *
 * The property that matters: a partner can never be paid more than they are
 * owed, including when two admins request payouts simultaneously. The claim
 * is a conditional UPDATE against the account's own balance, so the check and
 * the write are one statement.
 */
/**
 * Did this come from the (requestedByUserId, idempotencyKey) unique index?
 *
 * Narrow on purpose: a blanket "P2002 means already done" would also swallow
 * a collision on `ledgerTransactionId` or `settlementLedgerTransactionId`,
 * both of which are real bugs that must not surface as a successful replay.
 */
function isKeyCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes('idempotencyKey'));
}

@Injectable()
export class PayoutEngineService {
  private readonly logger = new Logger(PayoutEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** What the platform currently owes this partner, as a positive figure. */
  async availableBalance(partnerId: string, currency: Currency = Currency.AMD): Promise<Decimal> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId, currency },
    });
    if (!account) return new Decimal(0);
    // Credit-normal: a payable of 9,750 is stored as -9,750.
    return account.balance.negated();
  }

  async requestPayout(params: RequestPayoutParams): Promise<PayoutResult> {
    const amount = parsePositiveMoney(params.amount, 'payout amount');
    const currency = params.currency ?? Currency.AMD;

    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: params.partnerId },
    });
    if (!partner.isActive) {
      throw new BadRequestException('This partner is not currently active');
    }
    if (partner.payoutsBlockedAt) {
      // Reconciliation found the ledger and the bank disagreeing about this
      // partner. Paying out against a balance known to be wrong is the one
      // thing worse than not paying out at all.
      throw new BadRequestException(
        `Payouts are blocked for this partner: ${partner.payoutsBlockedReason ?? 'under review'}`,
      );
    }

    return this.idempotency.run<PayoutResult>(
      {
        scope: `payout:${params.actorId}`,
        key: params.idempotencyKey,
        request: { partnerId: partner.id, amount: amount.toString(), currency },
      },
      () => this.executePayout(partner.id, amount, currency, params.actorId, params.idempotencyKey),
    );
  }

  private async executePayout(
    partnerId: string,
    amount: Decimal,
    currency: Currency,
    actorId: string,
    idempotencyKey: string,
  ): Promise<PayoutResult> {
    // Has this key already produced a payout?
    //
    // `IdempotencyService` normally answers this. This is for when it
    // cannot — its record lost while the payout it described survived, which
    // is what a crash between the two transactions leaves behind. A retry
    // without this pays the partner a second time, bounded only by what they
    // are still owed.
    const already = await this.findByKey(actorId, idempotencyKey);
    if (already) return this.toResult(already, currency);

    const [payableAccount, clearingAccount] = await Promise.all([
      this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId,
        currency,
      }),
      this.ledger.accountFor({ type: LedgerAccountType.BANK_CLEARING, currency }),
    ]);

    let payout;
    try {
      payout = await this.prisma.$transaction(async (tx) => {
        // The whole concurrency story, in one line. `FOR UPDATE` holds this
        // account's row until the transaction commits, so a second payout
        // request against the same partner blocks here and then re-reads a
        // balance that already reflects the first one. Without it, both would
        // read the same pre-payout balance, both would find it sufficient, and
        // the partner would be paid twice.
        //
        // A conditional UPDATE would be the usual alternative, but not here:
        // `ledger.post` below moves this same balance, so a claim that also
        // moved it would double-count. Locking states the intent — exclude
        // concurrent readers — without touching the number.
        const locked = await tx.$queryRaw<Array<{ balance: string }>>`
        SELECT balance FROM "ledger_accounts" WHERE id = ${payableAccount.id} FOR UPDATE
      `;

        // Credit-normal: a payable of 9,750 is stored as -9,750.
        const available = new Decimal(locked[0]?.balance ?? 0).negated();
        if (available.lessThan(amount)) {
          throw new ConflictException(
            `Payout of ${amount.toString()} exceeds the ${available.toString()} available to this partner`,
          );
        }

        const created = await tx.payout.create({
          data: {
            partnerId,
            amount,
            status: PayoutStatus.REQUESTED,
            requestedByUserId: actorId,
            idempotencyKey,
          },
        });

        const ledgerTransaction = await this.ledger.post(
          {
            kind: 'payout.requested',
            sourceType: 'Payout',
            sourceId: created.id,
            currency,
            postings: [
              { accountId: payableAccount.id, direction: PostingDirection.DEBIT, amount },
              { accountId: clearingAccount.id, direction: PostingDirection.CREDIT, amount },
            ],
            events: [
              {
                aggregateType: 'Payout',
                aggregateId: created.id,
                eventType: 'payout.requested',
                payload: { payoutId: created.id, partnerId, amount: amount.toString() },
              },
            ],
          },
          tx,
        );

        return tx.payout.update({
          where: { id: created.id },
          data: { ledgerTransactionId: ledgerTransaction.id },
        });
      });
    } catch (err) {
      // A collision on (requestedByUserId, idempotencyKey) is this same
      // payout arriving twice, not a failure. Two attempts reach the INSERT
      // when they are genuinely concurrent or when one is a retry after the
      // idempotency record was lost; the loser's transaction rolls back
      // whole — ledger postings included — and it returns the winner's
      // payout rather than an error the caller cannot act on.
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(actorId, idempotencyKey);
        if (existing) return this.toResult(existing, currency);
      }
      throw err;
    }

    const remaining = await this.availableBalance(partnerId, currency);
    this.logger.log(`Payout ${payout.id} requested: ${amount.toString()} to partner ${partnerId}`);

    return {
      payoutId: payout.id,
      amount: amount.toFixed(MONEY_SCALE),
      status: payout.status,
      remainingBalance: remaining.toFixed(MONEY_SCALE),
    };
  }

  private findByKey(actorId: string, idempotencyKey: string) {
    return this.prisma.payout.findUnique({
      where: { requestedByUserId_idempotencyKey: { requestedByUserId: actorId, idempotencyKey } },
    });
  }

  /**
   * Rebuilds the answer for a caller whose original response never arrived.
   *
   * The remaining balance is read now rather than remembered: other payouts
   * and settlements may have moved it since, and the caller is better served
   * by what is true than by what was true.
   */
  private async toResult(
    payout: { id: string; amount: Decimal; status: PayoutStatus; partnerId: string },
    currency: Currency,
  ): Promise<PayoutResult> {
    const account = await this.ledger.accountFor({
      type: LedgerAccountType.PARTNER_PAYABLE,
      partnerId: payout.partnerId,
      currency,
    });
    return {
      payoutId: payout.id,
      amount: payout.amount.toFixed(MONEY_SCALE),
      status: payout.status,
      remainingBalance: new Decimal(account.balance).negated().toFixed(MONEY_SCALE),
    };
  }

  /**
   * The bank confirmed the transfer landed. Drains it out of BANK_CLEARING
   * into PLATFORM_BANK — the money is now genuinely gone rather than merely
   * in flight.
   *
   * This used to write no posting at all, only the status flip. The ledger
   * still balanced, because BANK_CLEARING was silently doing the platform
   * bank account's job — but it meant a confirmed payout looked identical to
   * one still in flight, and BANK_CLEARING's balance, which should answer
   * "how much is moving right now", answered "how much has ever moved".
   */
  async confirmPaid(
    payoutId: string,
    bankReference: string,
    confirmedByUserId: string,
  ): Promise<void> {
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status !== PayoutStatus.REQUESTED) {
      throw new BadRequestException(`Payout is already ${payout.status}`);
    }

    // ── Two-person rule ──────────────────────────────────────────────────
    //
    // Requesting a payout moves money out of a partner's balance into
    // BANK_CLEARING; confirming it is the assertion that the bank really
    // sent it. With one person doing both, a single compromised admin
    // session is enough to drain a partner's balance and mark the theft
    // settled, and every record left behind agrees that it was legitimate.
    //
    // Enforced here rather than in the controller so a script, a console
    // session or a future endpoint cannot route around it.
    //
    // Operationally this means the business needs two accounts holding
    // PAYOUT_MANAGE — in practice two SUPER_ADMINs, since that permission is
    // deliberately not granted to ADMIN. With one, every payout stays at
    // REQUESTED forever, which is why the flag exists rather than the rule
    // being unconditional.
    //
    // The check is skipped when the payout has no recorded requester —
    // those predate this column or came from a system process, and there is
    // no maker for a checker to differ from. It is not skipped for
    // convenience anywhere else.
    if (
      this.config.get('payouts.dualControl', { infer: true }) &&
      payout.requestedByUserId &&
      payout.requestedByUserId === confirmedByUserId
    ) {
      throw new ForbiddenException(
        'This payout must be confirmed by someone other than the person who requested it',
      );
    }

    const currency = Currency.AMD;
    const [clearingAccount, bankAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.BANK_CLEARING, currency }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_BANK, currency }),
    ]);

    await this.prisma.$transaction(async (tx) => {
      // The claim and the posting share a transaction, so a payout can never
      // end up PAID without the money having left BANK_CLEARING, or the
      // reverse. Two concurrent confirmations: one claims, the other finds
      // count === 0 and posts nothing.
      const claimed = await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.REQUESTED },
        data: {
          status: PayoutStatus.PAID,
          bankReference,
          confirmedByUserId,
          completedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This payout was already resolved');
      }

      const ledgerTransaction = await this.ledger.post(
        {
          kind: 'payout.settled',
          sourceType: 'Payout',
          sourceId: payoutId,
          currency,
          postings: [
            {
              accountId: clearingAccount.id,
              direction: PostingDirection.DEBIT,
              amount: payout.amount,
            },
            {
              accountId: bankAccount.id,
              direction: PostingDirection.CREDIT,
              amount: payout.amount,
            },
          ],
          events: [
            {
              aggregateType: 'Payout',
              aggregateId: payoutId,
              eventType: 'payout.settled',
              payload: {
                payoutId,
                partnerId: payout.partnerId,
                amount: payout.amount.toString(),
                bankReference,
              },
            },
          ],
        },
        tx,
      );

      await tx.payout.update({
        where: { id: payoutId },
        data: { settlementLedgerTransactionId: ledgerTransaction.id },
      });

      // The clock the biweekly settlement-check sweep reads per partner —
      // see `Partner.lastSettledAt`. A confirmed payout is a real,
      // bank-confirmed zeroing of this partner's settlement cycle, exactly
      // like `PartnerCollectionService.record` is for the other direction.
      await tx.partner.update({
        where: { id: payout.partnerId },
        data: { lastSettledAt: new Date() },
      });
    });

    this.logger.log(`Payout ${payoutId} confirmed paid, bank ref ${bankReference}`);
  }

  /**
   * The bank rejected the transfer. Returns the money to the partner's
   * payable balance by reversing the original posting — never by editing it.
   */
  async markFailed(payoutId: string, failureReason: string): Promise<void> {
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status !== PayoutStatus.REQUESTED) {
      throw new BadRequestException(`Payout is already ${payout.status}`);
    }

    const claimed = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: PayoutStatus.REQUESTED },
      data: { status: PayoutStatus.FAILED, failureReason, completedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This payout was already resolved');
    }

    if (payout.ledgerTransactionId) {
      await this.ledger.reverse(payout.ledgerTransactionId, 'payout.failed');
    }

    this.logger.warn(`Payout ${payoutId} failed: ${failureReason}`);
  }

  /**
   * A partner's payouts, with the two-person rule's participants named.
   *
   * The ids are resolved to names here rather than in the dashboard because
   * the whole point of the control is that a human looks at who requested
   * the transfer before confirming it, and nobody recognises a UUID. Users
   * are fetched in one query rather than per row.
   */
  async listForPartner(partnerId: string, limit = 30) {
    const payouts = await this.prisma.payout.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const actorIds = [
      ...new Set(
        payouts
          .flatMap((p) => [p.requestedByUserId, p.confirmedByUserId])
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

    return payouts.map((p) => ({
      ...p,
      // Null when nobody is recorded; the raw id when the actor is not a
      // user row (a script, or a seeded fixture) — which is itself worth
      // seeing rather than hiding behind a dash.
      requestedByName: p.requestedByUserId
        ? (nameOf.get(p.requestedByUserId) ?? p.requestedByUserId)
        : null,
      confirmedByName: p.confirmedByUserId
        ? (nameOf.get(p.confirmedByUserId) ?? p.confirmedByUserId)
        : null,
    }));
  }
}
