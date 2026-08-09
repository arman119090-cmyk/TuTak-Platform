import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  Currency,
  LedgerAccountType,
  PaymentStatus,
  PostingDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, Money, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';

export interface RefundParams {
  paymentId: string;
  /** Omit for a full refund of whatever remains unrefunded. */
  amount?: Money;
  reason: string;
  /** The operator or system actor requesting this; scopes the idempotency key. */
  actorId: string;
  idempotencyKey: string;
}

export interface RefundResult {
  refundId: string;
  amount: string;
  /** Total refunded against the payment after this refund, including this one. */
  totalRefunded: string;
  bonusClawedBack: string;
}

/**
 * Refunds, full and partial.
 *
 * Three properties matter, in descending order of how expensive they are to
 * get wrong:
 *
 *  1. **A payment can never be refunded past what was captured.** Enforced
 *     by a conditional UPDATE that both reads and writes the running total in
 *     one statement, so two concurrent refunds cannot each act on the same
 *     stale figure — and, underneath that, by the
 *     `payments_refunded_within_captured` CHECK constraint, so the guarantee
 *     survives this code being changed or bypassed.
 *  2. **Money and points reverse together.** A refunded purchase that leaves
 *     its loyalty points outstanding is a free-points machine: buy, earn,
 *     refund, keep.
 *  3. **A refund is never an edit.** Postings are immutable; a refund posts a
 *     new, reversing transaction that points back at the original.
 */
/**
 * Did this come from the (actorId, idempotencyKey) unique index?
 *
 * Narrow deliberately: a blanket "P2002 means already done" would also
 * swallow a collision on `ledgerTransactionId`, which is a real bug and must
 * not be reported to the caller as a successful replay.
 */
function isKeyCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes('idempotencyKey'));
}

@Injectable()
export class RefundEngineService {
  private readonly logger = new Logger(RefundEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly bonusEngine: BonusEngineService,
    private readonly idempotency: IdempotencyService,
    private readonly alerts: AlertsService,
  ) {}

  async refund(params: RefundParams): Promise<RefundResult> {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: params.paymentId },
    });

    if (payment.status !== PaymentStatus.CAPTURED) {
      throw new BadRequestException('Only a captured payment can be refunded');
    }

    const remaining = payment.amount.minus(payment.refundedAmount);
    const amount = params.amount ? parsePositiveMoney(params.amount, 'refund amount') : remaining;

    if (amount.greaterThan(remaining)) {
      throw new BadRequestException(
        `Refund of ${amount.toString()} exceeds the ${remaining.toString()} still refundable on this payment`,
      );
    }
    if (remaining.lessThanOrEqualTo(0)) {
      throw new BadRequestException('This payment has already been refunded in full');
    }

    return this.idempotency.run<RefundResult>(
      {
        scope: `refund:${params.actorId}`,
        key: params.idempotencyKey,
        request: { paymentId: payment.id, amount: amount.toString(), reason: params.reason },
      },
      () =>
        this.executeRefund(
          payment.id,
          amount,
          params.reason,
          params.actorId,
          params.idempotencyKey,
        ),
    );
  }

  private async executeRefund(
    paymentId: string,
    amount: Decimal,
    reason: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    // Has this key already produced a refund?
    //
    // `IdempotencyService` normally answers this and this branch never runs.
    // It is here for when it cannot — the record lost while the refund it
    // described survived, which a crash between the two transactions
    // produces. Without it the retry refunds again, bounded by what remains
    // refundable and no less wrong for that.
    const already = await this.findByKey(actorId, idempotencyKey);
    if (already) return this.toResult(already);

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    // The claim. Reading `refundedAmount` and writing it back are one
    // statement, and the WHERE clause re-checks the bound against the row as
    // it exists at write time — so of two concurrent refunds that would
    // together exceed the captured amount, exactly one succeeds.
    const claimed = await this.prisma.payment.updateMany({
      where: {
        id: paymentId,
        refundedAmount: { lte: payment.amount.minus(amount) },
      },
      data: { refundedAmount: { increment: amount } },
    });

    if (claimed.count === 0) {
      throw new ConflictException(
        'Another refund for this payment completed first and this one would exceed the captured amount',
      );
    }

    // Past this point the claim is committed. Anything that fails below must
    // release it, or the payment is left permanently under-refundable by the
    // amount of a refund that never happened.
    try {
      return await this.postRefund(payment, amount, reason, actorId, idempotencyKey);
    } catch (err) {
      // Release the claim first, whatever went wrong. It was taken on the
      // assumption a refund would follow, and none did.
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { refundedAmount: { decrement: amount } },
      });
      // A collision on (actorId, idempotencyKey) is not a failure — it is
      // this same refund arriving twice, and the unique index is what makes
      // that impossible to get wrong rather than merely unlikely. Two
      // attempts can both pass the lookup above if they are genuinely
      // concurrent, or if one is a retry after the record was lost; the
      // loser lands here and gets the winner's refund.
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(actorId, idempotencyKey);
        if (existing) return this.toResult(existing);
      }
      throw err;
    }
  }

  private findByKey(actorId: string, idempotencyKey: string) {
    return this.prisma.refund.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
    });
  }

  private toResult(refund: {
    id: string;
    amount: Decimal;
    bonusClawedBack: Decimal;
    paymentId: string;
  }): Promise<RefundResult> | RefundResult {
    // Reconstructing the result of a refund that already happened, for the
    // caller whose original response never arrived. `totalRefunded` is read
    // from the payment rather than remembered, because other refunds may have
    // landed since and the caller should see the truth, not a snapshot.
    return this.prisma.payment
      .findUniqueOrThrow({ where: { id: refund.paymentId } })
      .then((payment) => ({
        refundId: refund.id,
        amount: refund.amount.toFixed(MONEY_SCALE),
        totalRefunded: payment.refundedAmount.toFixed(MONEY_SCALE),
        bonusClawedBack: refund.bonusClawedBack.toFixed(MONEY_SCALE),
      }));
  }

  private async postRefund(
    payment: {
      id: string;
      userId: string;
      partnerId: string;
      amount: Decimal;
      commissionAmount: Decimal;
      currency: Currency;
      refundedAmount: Decimal;
      accruedLotId: string | null;
    },
    amount: Decimal,
    reason: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    const currency = payment.currency;

    // The commission is refunded in proportion: a half refund returns half
    // the platform's cut, so the partner never absorbs a fee on money they
    // did not keep.
    const commissionShare = payment.commissionAmount
      .times(amount)
      .dividedBy(payment.amount)
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
    const partnerShare = amount.minus(commissionShare);

    const [pspAccount, partnerAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE, currency }),
      this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId: payment.partnerId,
        currency,
      }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE, currency }),
    ]);

    const bonusClawedBack = await this.clawBackBonus(
      payment.accruedLotId,
      amount,
      payment.amount,
      reason,
    );

    const refund = await this.prisma.$transaction(async (tx) => {
      const ledgerTransaction = await this.ledger.post(
        {
          kind: 'payment.refunded',
          sourceType: 'Payment',
          sourceId: payment.id,
          currency,
          // The mirror image of capture, scaled to the refunded slice.
          postings: [
            {
              accountId: partnerAccount.id,
              direction: PostingDirection.DEBIT,
              amount: partnerShare,
            },
            {
              accountId: revenueAccount.id,
              direction: PostingDirection.DEBIT,
              amount: commissionShare,
            },
            { accountId: pspAccount.id, direction: PostingDirection.CREDIT, amount },
          ],
          events: [
            {
              aggregateType: 'Payment',
              aggregateId: payment.id,
              eventType: 'payment.refunded',
              payload: {
                paymentId: payment.id,
                userId: payment.userId,
                partnerId: payment.partnerId,
                amount: amount.toString(),
                reason,
              },
            },
          ],
        },
        tx,
      );

      return tx.refund.create({
        data: {
          paymentId: payment.id,
          amount,
          reason,
          bonusClawedBack,
          ledgerTransactionId: ledgerTransaction.id,
          actorId,
          idempotencyKey,
        },
      });
    });

    await this.warnIfPartnerNowOwesUs(payment.partnerId, currency, refund.id);

    const totalRefunded = payment.refundedAmount.plus(amount);
    this.logger.log(
      `Refunded ${amount.toString()} of payment ${payment.id} (total ${totalRefunded.toString()})`,
    );

    return {
      refundId: refund.id,
      amount: amount.toFixed(MONEY_SCALE),
      totalRefunded: totalRefunded.toFixed(MONEY_SCALE),
      bonusClawedBack: bonusClawedBack.toFixed(MONEY_SCALE),
    };
  }

  /**
   * A refund can leave a partner owing the platform money, and somebody has
   * to be told.
   *
   * The sequence is ordinary: a partner earns, the platform pays them, and a
   * customer is refunded afterwards. The refund debits a payable that the
   * payout already drained, so the account goes from credit-normal to
   * positive — the platform is now out of pocket and must recover the
   * difference from the partner.
   *
   * Nothing was broken by this. The ledger balances, the postings are
   * correct, and `requestPayout` will refuse the partner while the balance
   * is against them. What was missing is the part where anyone finds out:
   * the money is outside the platform and only a person can get it back.
   * Recovering it is a conversation, and a conversation nobody knows to have
   * is a write-off.
   *
   * Found by `money-sequence-fuzz.int-spec.ts`, which proposed the ordering
   * on its own — no hand-written test had put a refund after a payout that
   * emptied the balance.
   */
  private async warnIfPartnerNowOwesUs(
    partnerId: string,
    currency: Currency,
    refundId: string,
  ): Promise<void> {
    try {
      const account = await this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId,
        currency,
      });
      const owedToUs = new Decimal(account.balance);
      if (owedToUs.lessThanOrEqualTo(0)) return;

      await this.alerts.fire({
        severity: 'warning',
        // Keyed on the partner, not the refund: a run of refunds against one
        // partner is one conversation, not twenty notifications.
        key: `partner.in-debit:${partnerId}`,
        title: 'A refund left a partner owing the platform',
        body:
          `Partner ${partnerId} now owes ${owedToUs.toFixed(MONEY_SCALE)} ${currency}. ` +
          'This happens when a payout drained their balance before a refund reversed the ' +
          'payment behind it. Payouts to them are already refused while the balance is ' +
          'against them; recovering the money is a human conversation.',
        context: { partnerId, owed: owedToUs.toFixed(MONEY_SCALE), currency, refundId },
      });
    } catch (err) {
      // Never fail a refund because telling someone about it failed. The
      // money has already moved and the customer is owed their refund; a
      // missed notification is recoverable, a thrown exception here would
      // roll back nothing and confuse everything.
      this.logger.warn(
        `Could not check whether partner ${partnerId} is now in debit: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Reclaims the points this payment earned, in proportion to what is being
   * refunded.
   *
   * Only points that were actually issued can be reclaimed — a payment
   * refunded before it settled never accrued, and `accruedLotId` is null, so
   * there is nothing to take back. `reverseAccrualLot` claws back only the
   * unspent remainder by design: a customer who already spent their points is
   * not pushed into a negative balance by a later refund. That is a
   * deliberate choice to absorb the loss rather than produce a wallet that
   * cannot be reasoned about — the alternative, a negative balance, breaks
   * every invariant the bonus engine is built on.
   */
  private async clawBackBonus(
    accruedLotId: string | null,
    refundAmount: Decimal,
    paymentAmount: Decimal,
    reason: string,
  ): Promise<Decimal> {
    if (!accruedLotId) return new Decimal(0);

    const lot = await this.prisma.bonusLot.findUnique({ where: { id: accruedLotId } });
    if (!lot) return new Decimal(0);

    // A full refund takes the whole unspent remainder; a partial refund takes
    // the same proportion of what was originally issued.
    const cap = refundAmount.equals(paymentAmount)
      ? undefined
      : lot.originalAmount
          .times(refundAmount)
          .dividedBy(paymentAmount)
          .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN);

    const reclaimed = await this.bonusEngine.reverseAccrualLot(accruedLotId, reason, cap);
    return reclaimed ?? new Decimal(0);
  }

  listForPayment(paymentId: string) {
    return this.prisma.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
