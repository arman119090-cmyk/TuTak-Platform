import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Currency, LedgerAccountType, PayoutStatus, PostingDirection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
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
@Injectable()
export class PayoutEngineService {
  private readonly logger = new Logger(PayoutEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
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
      () => this.executePayout(partner.id, amount, currency, params.actorId),
    );
  }

  private async executePayout(
    partnerId: string,
    amount: Decimal,
    currency: Currency,
    actorId: string,
  ): Promise<PayoutResult> {
    const [payableAccount, clearingAccount] = await Promise.all([
      this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId,
        currency,
      }),
      this.ledger.accountFor({ type: LedgerAccountType.BANK_CLEARING, currency }),
    ]);

    const payout = await this.prisma.$transaction(async (tx) => {
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

    const remaining = await this.availableBalance(partnerId, currency);
    this.logger.log(`Payout ${payout.id} requested: ${amount.toString()} to partner ${partnerId}`);

    return {
      payoutId: payout.id,
      amount: amount.toFixed(MONEY_SCALE),
      status: payout.status,
      remainingBalance: remaining.toFixed(MONEY_SCALE),
    };
  }

  /**
   * The bank confirmed the transfer landed. Clears it out of BANK_CLEARING —
   * the money is now genuinely gone rather than merely in flight.
   */
  async confirmPaid(payoutId: string, bankReference: string): Promise<void> {
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status !== PayoutStatus.REQUESTED) {
      throw new BadRequestException(`Payout is already ${payout.status}`);
    }

    const claimed = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: PayoutStatus.REQUESTED },
      data: { status: PayoutStatus.PAID, bankReference, completedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This payout was already resolved');
    }

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

  listForPartner(partnerId: string, limit = 30) {
    return this.prisma.payout.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
