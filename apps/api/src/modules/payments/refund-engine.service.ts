import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  Currency,
  LedgerAccountType,
  PaymentStatus,
  PostingDirection,
  Prisma,
  RefundPspStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'crypto';
import { MONEY_SCALE, Money, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { PSP_ADAPTER, PspAdapter, PspRefundResult } from './psp-adapter.interface';

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
  /** Total refunded against the payment after this refund, including this one — a claimed/reserved total while PENDING, not necessarily money the PSP has confirmed moving yet. */
  totalRefunded: string;
  bonusClawedBack: string;
  /**
   * Whether the acquirer has actually confirmed this refund. `PENDING` means
   * exactly that — submitted, outcome not yet known — and the caller must
   * not treat it as money having moved; `reconcilePendingRefunds()` resolves
   * it later. A `FAILED` outcome is never returned here: it is thrown as a
   * `BadRequestException` instead, matching every other definitive refund
   * failure in this engine.
   */
  pspStatus: RefundPspStatus;
}

type RefundRow = Prisma.RefundGetPayload<object>;
type PaymentRow = Prisma.PaymentGetPayload<object>;

/**
 * Refunds, full and partial.
 *
 * Four properties matter, in descending order of how expensive they are to
 * get wrong:
 *
 *  1. **A refund is not real until the acquirer confirms it.** P0 finding,
 *     2026-08-19 hardening pass (GitHub issue #28): `PspAdapter` used to
 *     expose `charge()` but no refund operation at all, and this engine
 *     posted the reversing ledger entries, clawed back bonus, and marked
 *     `Payment.refundedAmount`/`Refund` as done purely from its own
 *     decision to refund — no acquirer was ever asked to move money. Now a
 *     `Refund` row is born `PENDING`, and the ledger postings and bonus
 *     clawback are only ever applied once `psp.refund()` (or a later
 *     `reconcilePendingRefunds()` poll) reports the money actually moved.
 *  2. **A payment can never be refunded past what was captured.** Enforced
 *     by a conditional UPDATE that both reads and writes the running total in
 *     one statement, so two concurrent refunds cannot each act on the same
 *     stale figure — and, underneath that, by the
 *     `payments_refunded_within_captured` CHECK constraint, so the guarantee
 *     survives this code being changed or bypassed. The claim is taken
 *     before the acquirer is ever called, in the same transaction as the
 *     durable `PENDING` row it protects — a genuinely unknown PSP outcome
 *     (a timeout, a crash before this process learns the answer) leaves the
 *     claim in place rather than released, because the acquirer may have
 *     processed it regardless of whether this process found out.
 *  3. **Money and points reverse together.** A refunded purchase that leaves
 *     its loyalty points outstanding is a free-points machine: buy, earn,
 *     refund, keep. Deferred until the refund is CONFIRMED, for the same
 *     reason as point 1 — a clawback the acquirer never backed with real
 *     money is itself a false financial record.
 *  4. **A refund is never an edit.** Postings are immutable; a refund posts a
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

/**
 * The key sent to the acquirer as *its* idempotency key for this refund.
 *
 * Deliberately a pure function of stable inputs — never a freshly-generated
 * value stored somewhere and looked up — so that a retry after this process
 * crashes between deciding to call the PSP and persisting anything about
 * that call reproduces the exact same key with nothing to recover from
 * disk. The acquirer's own idempotency handling, keyed on this value, is
 * what then makes a duplicate external call safe rather than merely
 * unlikely to happen.
 */
export function derivePspRefundIdempotencyKey(
  paymentId: string,
  actorId: string,
  idempotencyKey: string,
): string {
  return createHash('sha256').update(`refund:${paymentId}:${actorId}:${idempotencyKey}`).digest('hex');
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
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
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
    // Has this key already produced a refund (or a claim towards one)?
    //
    // `IdempotencyService` normally answers this and this branch never runs.
    // It is here for when it cannot — the record lost while the refund it
    // described survived, which a crash between the two transactions
    // produces. Without it a retry would re-claim and re-call the PSP for a
    // refund already in flight or already resolved.
    const already = await this.findByKey(actorId, idempotencyKey);
    if (already) return this.resultFromRow(already);

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const pspIdempotencyKey = derivePspRefundIdempotencyKey(paymentId, actorId, idempotencyKey);

    // The claim, and the durable record of it, as one atomic unit. Reading
    // `refundedAmount` and writing it back are one statement, and the WHERE
    // clause re-checks the bound against the row as it exists at write
    // time — so of two concurrent refunds that would together exceed the
    // captured amount, exactly one succeeds. Creating the `Refund` row in
    // the same transaction means a crash the instant after this commits
    // always leaves a real, discoverable PENDING row behind — never a
    // claimed amount with nothing to show for it, which was reachable in
    // the pre-fix code the moment more than one statement stood between
    // "claimed" and "recorded".
    let refund: RefundRow;
    try {
      refund = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.payment.updateMany({
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
        return tx.refund.create({
          data: {
            paymentId,
            amount,
            reason,
            actorId,
            idempotencyKey,
            pspIdempotencyKey,
            pspStatus: RefundPspStatus.PENDING,
          },
        });
      });
    } catch (err) {
      // A collision on (actorId, idempotencyKey) is not a failure — it is
      // this same refund arriving twice, and the unique index is what makes
      // that impossible to get wrong rather than merely unlikely. The
      // loser's whole transaction (claim included) rolled back automatically
      // when the INSERT it contained was rejected, so there is nothing here
      // to release by hand.
      if (isKeyCollision(err)) {
        const existing = await this.findByKey(actorId, idempotencyKey);
        if (existing) return this.resultFromRow(existing);
      }
      throw err;
    }

    return this.callPspAndFinalize(refund, payment);
  }

  private findByKey(actorId: string, idempotencyKey: string) {
    return this.prisma.refund.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
    });
  }

  /**
   * Reconstructs the result of a refund whose row already exists, for a
   * caller replaying an idempotency key. `totalRefunded` is read from the
   * payment rather than remembered, because other refunds may have landed
   * since and the caller should see the truth, not a stale snapshot.
   *
   * A `FAILED` row throws the same `BadRequestException` a fresh decline
   * would — a replay of a request that definitively failed must keep
   * failing the same way, not silently report success.
   */
  private async resultFromRow(refund: RefundRow): Promise<RefundResult> {
    if (refund.pspStatus === RefundPspStatus.FAILED) {
      throw new BadRequestException(
        `The payment provider declined this refund: ${refund.pspDeclineReason ?? 'declined'}`,
      );
    }
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
    return {
      refundId: refund.id,
      amount: refund.amount.toFixed(MONEY_SCALE),
      totalRefunded: payment.refundedAmount.toFixed(MONEY_SCALE),
      bonusClawedBack: refund.bonusClawedBack.toFixed(MONEY_SCALE),
      pspStatus: refund.pspStatus,
    };
  }

  /**
   * Calls the acquirer and applies whatever it says. Split from
   * `executeRefund` so `reconcilePendingRefunds()` can drive the same
   * outcome-handling logic without repeating the claim step, which must
   * only ever happen once per refund.
   */
  private async callPspAndFinalize(refund: RefundRow, payment: PaymentRow): Promise<RefundResult> {
    let pspResult: PspRefundResult;
    try {
      pspResult = await this.psp.refund({
        amount: refund.amount,
        currency: payment.currency,
        pspChargeReference: payment.pspReference ?? '',
        // Always set — `executeRefund` writes it in the same transaction
        // that creates this row.
        idempotencyKey: refund.pspIdempotencyKey!,
        reason: refund.reason,
      });
    } catch (err) {
      // Unreachable or misbehaving, not declined — the one case `PspAdapter`
      // documents as safe to retry/reconcile rather than treat as failed.
      // The claim and the PENDING row both already exist; there is nothing
      // to release, because the acquirer may have processed this refund
      // regardless of whether this process ever found out.
      this.logger.warn(
        `PSP refund call for refund ${refund.id} (payment ${payment.id}) did not return a ` +
          `result and was left PENDING for reconciliation: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return this.pendingResult(refund, payment);
    }

    return this.applyPspRefundOutcome(refund, payment, pspResult);
  }

  private async applyPspRefundOutcome(
    refund: RefundRow,
    payment: PaymentRow,
    pspResult: PspRefundResult,
  ): Promise<RefundResult> {
    if (pspResult.outcome === 'PENDING') {
      const updated = await this.prisma.refund.update({
        where: { id: refund.id },
        data: { pspRefundReference: pspResult.pspRefundReference ?? refund.pspRefundReference },
      });
      return this.pendingResult(updated, payment);
    }

    if (pspResult.outcome === 'DECLINED') {
      // Release the claim: the acquirer definitively refused, so nothing
      // moved and the amount is refundable again.
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { refundedAmount: { decrement: refund.amount } },
        }),
        this.prisma.refund.update({
          where: { id: refund.id },
          data: { pspStatus: RefundPspStatus.FAILED, pspDeclineReason: pspResult.declineReason },
        }),
      ]);
      throw new BadRequestException(
        `The payment provider declined this refund: ${pspResult.declineReason}`,
      );
    }

    return this.finalizeConfirmedRefund(refund, payment, pspResult.pspRefundReference);
  }

  private pendingResult(refund: RefundRow, payment: PaymentRow): Promise<RefundResult> {
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }).then((p) => ({
      refundId: refund.id,
      amount: refund.amount.toFixed(MONEY_SCALE),
      totalRefunded: p.refundedAmount.toFixed(MONEY_SCALE),
      bonusClawedBack: '0.0000',
      pspStatus: RefundPspStatus.PENDING,
    }));
  }

  /**
   * The acquirer has confirmed the money moved — only now do the reversing
   * ledger postings and any bonus clawback happen, and only now does
   * `Refund.pspStatus` become CONFIRMED. Shared between the synchronous
   * `callPspAndFinalize` path and `reconcilePendingRefunds()`, so a refund
   * that was PENDING for an hour and a refund confirmed in the same request
   * that submitted it produce the exact same financial effects.
   */
  private async finalizeConfirmedRefund(
    refund: RefundRow,
    payment: PaymentRow,
    pspRefundReference: string,
  ): Promise<RefundResult> {
    const currency = payment.currency;

    // The commission is refunded in proportion: a half refund returns half
    // the platform's cut, so the partner never absorbs a fee on money they
    // did not keep.
    const commissionShare = payment.commissionAmount
      .times(refund.amount)
      .dividedBy(payment.amount)
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
    const partnerShare = refund.amount.minus(commissionShare);

    const [pspAccount, partnerAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE, currency }),
      this.ledger.accountFor({
        type: LedgerAccountType.PARTNER_PAYABLE,
        partnerId: payment.partnerId,
        currency,
      }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE, currency }),
    ]);

    // The clawback lives inside the same transaction as the ledger post and
    // the refund's own CONFIRMED update, below — all three commit together
    // or none do. Before this fix (found while adding this transaction
    // boundary, not part of the original P0 report) they were three
    // independent statements: a clawback that succeeded while the ledger
    // post that followed it failed left a customer's points already taken
    // back with no ledger entry and no CONFIRMED refund to justify it —
    // exactly the "money and points must reverse together" invariant this
    // class's own docblock names, broken by the code meant to enforce it.
    let bonusClawedBack = new Decimal(0);

    const updated = await this.prisma.$transaction(async (tx) => {
      bonusClawedBack = await this.clawBackBonus(
        payment.accruedLotId,
        refund.amount,
        payment.amount,
        refund.reason,
        tx,
      );

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
            { accountId: pspAccount.id, direction: PostingDirection.CREDIT, amount: refund.amount },
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
                amount: refund.amount.toString(),
                reason: refund.reason,
                pspRefundReference,
              },
            },
          ],
        },
        tx,
      );

      return tx.refund.update({
        where: { id: refund.id },
        data: {
          pspStatus: RefundPspStatus.CONFIRMED,
          pspRefundReference,
          bonusClawedBack,
          ledgerTransactionId: ledgerTransaction.id,
        },
      });
    });

    await this.warnIfPartnerNowOwesUs(payment.partnerId, currency, refund.id);

    const freshPayment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    this.logger.log(
      `Refunded ${refund.amount.toString()} of payment ${payment.id} ` +
        `(total ${freshPayment.refundedAmount.toString()}), confirmed by the PSP as ${pspRefundReference}`,
    );

    return {
      refundId: updated.id,
      amount: refund.amount.toFixed(MONEY_SCALE),
      totalRefunded: freshPayment.refundedAmount.toFixed(MONEY_SCALE),
      bonusClawedBack: bonusClawedBack.toFixed(MONEY_SCALE),
      pspStatus: RefundPspStatus.CONFIRMED,
    };
  }

  /**
   * Resolves every refund still awaiting a PSP answer. Run on a schedule
   * (`sweeps.jobs.ts` › `payments.reconcile-pending-refunds`) so a refund
   * whose original request only ever got a timeout, a crash, or an
   * explicit "processing" response from the acquirer does not stay
   * ambiguous forever — this is the retry/reconciliation path the P0
   * finding required for exactly that ambiguity.
   *
   * Never re-submits a refund — only ever asks the acquirer what it already
   * knows via `checkRefundStatus`, keyed on the same `pspIdempotencyKey`
   * the original attempt used.
   */
  async reconcilePendingRefunds(): Promise<number> {
    const pending = await this.prisma.refund.findMany({
      where: { pspStatus: RefundPspStatus.PENDING },
    });

    let resolved = 0;
    for (const refund of pending) {
      if (await this.reconcileOne(refund)) resolved += 1;
    }
    return resolved;
  }

  private async reconcileOne(refund: RefundRow): Promise<boolean> {
    // A row predating this fix (backfilled CONFIRMED by the migration) or
    // one somehow missing its PSP key has nothing to poll — leave it for a
    // human, do not guess.
    if (!refund.pspIdempotencyKey) return false;

    const payment = await this.prisma.payment.findUnique({ where: { id: refund.paymentId } });
    if (!payment) return false;

    let pspResult: PspRefundResult;
    try {
      pspResult = await this.psp.checkRefundStatus(refund.pspIdempotencyKey);
    } catch (err) {
      this.logger.warn(
        `checkRefundStatus failed for refund ${refund.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }

    if (pspResult.outcome === 'PENDING') return false;

    if (pspResult.outcome === 'DECLINED') {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { refundedAmount: { decrement: refund.amount } },
        }),
        this.prisma.refund.update({
          where: { id: refund.id },
          data: { pspStatus: RefundPspStatus.FAILED, pspDeclineReason: pspResult.declineReason },
        }),
      ]);
      this.logger.warn(
        `Reconciled refund ${refund.id} as declined by the PSP: ${pspResult.declineReason}`,
      );
      return true;
    }

    await this.finalizeConfirmedRefund(refund, payment, pspResult.pspRefundReference);
    this.logger.log(`Reconciled refund ${refund.id} as confirmed by the PSP`);
    return true;
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
    tx: Prisma.TransactionClient,
  ): Promise<Decimal> {
    if (!accruedLotId) return new Decimal(0);

    const lot = await tx.bonusLot.findUnique({ where: { id: accruedLotId } });
    if (!lot) return new Decimal(0);

    // A full refund takes the whole unspent remainder; a partial refund takes
    // the same proportion of what was originally issued.
    const cap = refundAmount.equals(paymentAmount)
      ? undefined
      : lot.originalAmount
          .times(refundAmount)
          .dividedBy(paymentAmount)
          .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN);

    const reclaimed = await this.bonusEngine.reverseAccrualLot(accruedLotId, reason, cap, tx);
    return reclaimed ?? new Decimal(0);
  }

  listForPayment(paymentId: string) {
    return this.prisma.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
