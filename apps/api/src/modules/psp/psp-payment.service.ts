import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerAccountType,
  PaymentRoute,
  PostingDirection,
  Prisma,
  PspAttemptStatus,
  PspResolutionBasis,
  PurchaseIntentStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PurchaseIntentsService } from '../purchase-intents/purchase-intents.service';
import { MONEY_MAY_HAVE_MOVED } from './psp-attempt-safety';
import { PSP_ADAPTER, PspAdapter } from './psp-adapter.interface';

type Tx = Prisma.TransactionClient;

/**
 * The states a verified provider confirmation may still settle from.
 *
 * `EXPIRED` is the one that was missing, and its absence was a real defect
 * found by Arman on 15.09.2026. `EXPIRED` means the platform stopped waiting;
 * it does not mean the provider stopped processing. A customer who paid at
 * minute 31 of a 30-minute window had genuinely paid, and the callback saying
 * so could not be applied: the claim accepted only `INITIATED` and
 * `PENDING_CONFIRMATION`, so the confirmation was refused and the money sat
 * with the provider against a purchase nothing could complete.
 *
 * `FAILED` is deliberately not here, and neither is any attempt carrying a
 * `resolutionBasis`: those have been *answered*, by the provider itself or by
 * two people reading its statement, and an answer outranks a later callback.
 * That is what stops a late callback and a manual reconciliation both
 * "winning" and the purchase being accounted for twice.
 */
const CONFIRMABLE: readonly PspAttemptStatus[] = [
  PspAttemptStatus.INITIATED,
  PspAttemptStatus.PENDING_CONFIRMATION,
  PspAttemptStatus.EXPIRED,
];

/** The value `liveKey` holds while an attempt is unresolved. */
const LIVE = 'live';

/**
 * Collecting a purchase's real-money remainder through a payment provider.
 *
 * ## What this adds to a purchase, and what it deliberately does not
 *
 * Exactly one ledger transaction: DEBIT `PSP_RECEIVABLE`, CREDIT
 * `PARTNER_PAYABLE`. The platform now has a claim on the acquirer and owes
 * the partner the money the customer handed over.
 *
 * Nothing else changes. Bonus accrual, the referral split, the partner's
 * commission and the compensation for a discount are all posted by
 * `PurchaseIntentsService.settlePurchase` exactly as they are for a purchase
 * paid in cash. That is the requirement stated plainly — same economics, only
 * the cash movement differs — and it is why this service is small.
 *
 * Worked through against the brief's own figures. 50 litres at 300, 1,000 in
 * bonus, provider route: the contribution postings leave the partner at +500
 * as they would for cash, this service credits the remaining 14,000, and the
 * partner's position is +14,500 — their entitlement, which is right, because
 * the partner received nothing at the pump.
 *
 * ## Why the provider's own success page is not evidence
 *
 * A customer returning to a success URL proves only that a browser followed a
 * redirect. Money is moved here on one thing: a callback whose signature the
 * adapter has verified and whose amount matches what was asked for.
 */
@Injectable()
export class PspPaymentService {
  private readonly logger = new Logger(PspPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly purchases: PurchaseIntentsService,
    @Inject(PSP_ADAPTER) private readonly adapter: PspAdapter,
  ) {}

  /**
   * Refuses a cashier confirmation when a provider might already have taken
   * the money.
   *
   * Called by the direct-confirmation path. The database enforces that a
   * provider attempt can only exist on a provider-routed purchase; this
   * covers the other half — that such a purchase is never confirmed by hand.
   */
  async assertDirectCollectionAllowed(intentId: string, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    const intent = await db.purchaseIntent.findUnique({
      where: { id: intentId },
      select: { paymentRoute: true },
    });
    if (!intent) throw new NotFoundException('Purchase not found');
    if (intent.paymentRoute !== PaymentRoute.DIRECT_PARTNER) {
      throw new ConflictException(
        'This purchase is being paid through a payment provider. It cannot also be ' +
          'collected at the till — that is how a customer pays twice. If the provider ' +
          'payment failed, the customer starts a new purchase.',
      );
    }
  }

  /**
   * Opens a bill at the provider.
   *
   * The attempt row is written *before* the provider is called, and that
   * ordering is deliberate: if the call succeeds and this process then dies,
   * a bill exists at the provider with a row here pointing at it. The other
   * order would leave a bill nothing in this system knows about — money a
   * customer can pay into a void.
   */
  async beginAttempt(params: { purchaseIntentId: string; customerId: string }) {
    const intent = await this.prisma.purchaseIntent.findUnique({
      where: { id: params.purchaseIntentId },
      select: {
        id: true,
        customerId: true,
        status: true,
        paymentRoute: true,
        ordinaryPaymentRemainder: true,
        partnerId: true,
        merchantApprovedAt: true,
      },
    });
    if (!intent) throw new NotFoundException('Purchase not found');
    if (intent.customerId !== params.customerId) {
      throw new NotFoundException('Purchase not found');
    }
    if (intent.paymentRoute !== PaymentRoute.TUTAK_PSP) {
      throw new ConflictException('This purchase is not routed through a payment provider');
    }
    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      throw new ConflictException(`Purchase is ${intent.status}`);
    }
    if (intent.ordinaryPaymentRemainder.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'Nothing to collect: this purchase is covered entirely by bonus points',
      );
    }

    /*
     * Nobody at the business has agreed this sale is real.
     *
     * The provider will confirm that money moved, and that is all it can
     * confirm. The gross, the quantity and the unit price on this purchase
     * were typed by the customer; one verified callback on them would credit
     * the partner, mint the customer's own cashback and pay their referrers
     * for a sale that never happened. Arman's decision of 15.09.2026.
     *
     * The database refuses the same thing — a provider attempt cannot be
     * inserted against an unapproved purchase — so this check is the sentence
     * a caller gets, not the guarantee.
     */
    if (!intent.merchantApprovedAt) {
      throw new ConflictException(
        'This purchase has not been approved by the business yet. Staff confirm what is ' +
          'being sold before a payment can be started.',
      );
    }

    /*
     * No second bill while an earlier attempt might hold the customer's money.
     *
     * The unique index on `(purchaseIntentId, liveKey)` is not enough on its
     * own, and that gap was real: an amount mismatch clears `liveKey` (the
     * attempt is no longer *live*) while leaving the money's fate unknown.
     * Without this check the customer could be handed a fresh bill for a
     * purchase the provider may already have charged them for. Found by
     * Arman's review.
     *
     * `EXPIRED` and `REQUIRES_RECONCILIATION` are both in the unsafe set for
     * the same reason `EXPIRED` always was: nothing authoritative said the
     * money did not move. Only an explicit provider failure clears a purchase
     * for another attempt.
     */
    if (await this.hasUnsafeAttempt(intent.id)) {
      throw new ConflictException(
        'An earlier payment attempt for this purchase is unresolved, and the provider ' +
          'may already hold the money. A new payment cannot be started until that ' +
          'attempt is resolved — this is what stops the customer paying twice.',
      );
    }

    const billId = randomUUID();
    let attempt;
    try {
      attempt = await this.prisma.pspPaymentAttempt.create({
        data: {
          purchaseIntentId: intent.id,
          provider: this.adapter.name,
          status: PspAttemptStatus.INITIATED,
          amount: intent.ordinaryPaymentRemainder,
          providerBillId: billId,
          liveKey: LIVE,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // The unique index on (purchaseIntentId, liveKey) did its job: a
        // second tap on "pay" cannot open a second bill.
        throw new ConflictException(
          'A payment for this purchase is already in progress. Finish or cancel it first.',
        );
      }
      throw err;
    }

    const bill = await this.adapter.createBill({
      billId,
      amount: intent.ordinaryPaymentRemainder,
      currency: 'AMD',
      description: `TuTak purchase ${intent.id}`,
    });

    if (bill.providerBillId) {
      await this.prisma.pspPaymentAttempt.update({
        where: { id: attempt.id },
        data: { providerBillId: bill.providerBillId },
      });
    }

    return { attemptId: attempt.id, redirectUrl: bill.redirectUrl, billId };
  }

  /**
   * Settles a verified confirmation.
   *
   * Idempotent by construction rather than by checking first: the unique
   * index on `(provider, providerTransactionId)` means a replayed callback
   * cannot create a second settled attempt, and the conditional update means
   * it cannot re-post the ledger either. Ten deliveries of the same callback
   * move money once.
   */
  async settleVerifiedConfirmation(confirmation: {
    billId: string;
    providerTransactionId: string;
    amount: Prisma.Decimal;
    feeAmount?: Prisma.Decimal;
    raw: unknown;
  }) {
    /*
     * The checks that can *refuse* happen before the transaction that can
     * *pay*, and that ordering is a bug fix rather than a style.
     *
     * Holding a mismatched confirmation used to be written inside the money
     * transaction and followed by a throw — so the hold rolled back with the
     * throw, the attempt stayed INITIATED, and a callback claiming a
     * different amount than the bill left no trace at all. That is precisely
     * the event most worth keeping: it is either a partial payment this
     * platform does not support, or somebody editing an amount.
     *
     * Caught by `psp-payment.int-spec.ts`, which asserts the attempt is held
     * rather than merely that settlement was refused.
     */
    const found = await this.prisma.pspPaymentAttempt.findFirst({
      where: { provider: this.adapter.name, providerBillId: confirmation.billId },
      select: { id: true, status: true, amount: true },
    });
    if (!found) {
      this.logger.error(
        `PSP confirmation for unknown bill ${confirmation.billId} — not settled, needs investigation`,
      );
      throw new NotFoundException('Unknown bill');
    }
    if (found.status === PspAttemptStatus.SUCCEEDED) {
      return { alreadySettled: true, attemptId: found.id };
    }
    if (!confirmation.amount.equals(found.amount)) {
      await this.prisma.pspPaymentAttempt.updateMany({
        where: { id: found.id, status: { in: [...CONFIRMABLE] } },
        data: {
          status: PspAttemptStatus.REQUIRES_RECONCILIATION,
          liveKey: null,
          failureReason: `Amount mismatch: expected ${found.amount.toFixed(4)}, provider said ${confirmation.amount.toFixed(4)}`,
          providerPayload: confirmation.raw as Prisma.InputJsonValue,
          resolvedAt: new Date(),
        },
      });
      this.logger.error(
        `PSP amount mismatch on bill ${confirmation.billId}: expected ${found.amount.toFixed(4)}, ` +
          `provider said ${confirmation.amount.toFixed(4)} — held for reconciliation`,
      );
      throw new ConflictException('Amount mismatch — held for reconciliation');
    }

    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.pspPaymentAttempt.findFirst({
        where: { provider: this.adapter.name, providerBillId: confirmation.billId },
        include: { purchaseIntent: { select: { id: true, partnerId: true } } },
      });
      if (!attempt) {
        // A confirmation for a bill this platform never opened. Never
        // discarded silently — it is either an attack or a lost row, and both
        // need a human.
        this.logger.error(
          `PSP confirmation for unknown bill ${confirmation.billId} — not settled, needs investigation`,
        );
        throw new NotFoundException('Unknown bill');
      }

      if (attempt.status === PspAttemptStatus.SUCCEEDED) {
        // Replay. Already done, and saying so is the correct response.
        return { alreadySettled: true, attemptId: attempt.id };
      }

      // Re-checked inside the transaction: the pre-check above rejects the
      // common case, this closes the window where the row changed between.
      if (!confirmation.amount.equals(attempt.amount)) {
        throw new ConflictException('Amount mismatch — held for reconciliation');
      }

      const [receivable, payable] = await Promise.all([
        this.ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE }),
        this.ledger.accountFor({
          type: LedgerAccountType.PARTNER_PAYABLE,
          partnerId: attempt.purchaseIntent.partnerId,
        }),
      ]);

      const posted = await this.ledger.post(
        {
          kind: 'psp.payment.captured',
          sourceType: 'PspPaymentAttempt',
          sourceId: attempt.id,
          postings: [
            { accountId: receivable.id, direction: PostingDirection.DEBIT, amount: attempt.amount },
            { accountId: payable.id, direction: PostingDirection.CREDIT, amount: attempt.amount },
          ],
        },
        tx,
      );

      /*
       * The purchase itself, in this same transaction.
       *
       * Both halves or neither: the cash leg above and everything a confirmed
       * purchase means — points accrued, referral paid, commission posted,
       * the intent marked CONFIRMED — commit together. Before this call
       * existed the provider's money moved and the purchase stayed
       * unconfirmed, which is a customer charged for points they never got.
       */
      await this.purchases.settleFromProviderConfirmation(attempt.purchaseIntentId, tx);

      const claimed = await tx.pspPaymentAttempt.updateMany({
        where: {
          id: attempt.id,
          status: { in: [...CONFIRMABLE] },
          // Nothing authoritative has said otherwise. An attempt carrying a
          // basis has been answered — by the provider, or by two people
          // reading its statement — and that answer outranks a callback
          // arriving afterwards. Part of the same `where` as the status so
          // the check and the claim are one atomic act rather than a
          // read followed by a hope.
          resolutionBasis: null,
        },
        data: {
          status: PspAttemptStatus.SUCCEEDED,
          resolutionBasis: PspResolutionBasis.PROVIDER_CALLBACK,
          providerTransactionId: confirmation.providerTransactionId,
          providerFeeAmount: confirmation.feeAmount ?? null,
          ledgerTransactionId: posted.id,
          confirmedAt: new Date(),
          resolvedAt: new Date(),
          liveKey: null,
          providerPayload: confirmation.raw as Prisma.InputJsonValue,
        },
      });
      if (claimed.count === 0) {
        // Either a concurrent callback won, or a human resolved it first.
        // Rolling back takes the ledger posting and the purchase settlement
        // with it, which is the point: one attempt, one outcome, one set of
        // postings.
        throw new ConflictException('Attempt was resolved concurrently');
      }

      return { alreadySettled: false, attemptId: attempt.id, ledgerTransactionId: posted.id };
    });
  }

  /**
   * Two people have read the provider's statement and agree no money moved.
   *
   * The only way an `EXPIRED` or `REQUIRES_RECONCILIATION` attempt is ever
   * released, short of the provider itself answering. Arman's decision of
   * 15.09.2026: a timeout is not a provider saying no, so nothing about the
   * passage of time can do this — not a sweep, not an operator clicking
   * "give up", not a retention job. Only a reading of the provider's own
   * record, by two people who are not the same person.
   *
   * Once this lands the purchase is genuinely free: `hasUnsafeAttempt` goes
   * false, a new attempt may be started and the customer may buy again at
   * that business. That is the entire consequence, and it is why the bar is
   * two people and a written reason rather than a confirmation dialog.
   *
   * Note what this does **not** do: it never marks an attempt `SUCCEEDED`.
   * Money arriving is settled by a verified provider confirmation and by
   * nothing else — a human asserting that a payment worked would post to the
   * ledger on somebody's word, which is the one thing this whole module is
   * built to prevent.
   */
  async reconcileAttemptManually(params: {
    attemptId: string;
    reconciledByUserId: string;
    checkedByUserId: string;
    evidence: string;
  }) {
    const evidence = params.evidence.trim();
    if (!evidence) {
      throw new BadRequestException('Say what the provider’s record shows — evidence is required');
    }
    if (params.reconciledByUserId === params.checkedByUserId) {
      throw new ForbiddenException(
        'Releasing a payment nobody can account for takes two different people',
      );
    }

    const attempt = await this.prisma.pspPaymentAttempt.findUnique({
      where: { id: params.attemptId },
    });
    if (!attempt) throw new NotFoundException('Payment attempt not found');
    if (
      attempt.status !== PspAttemptStatus.EXPIRED &&
      attempt.status !== PspAttemptStatus.REQUIRES_RECONCILIATION
    ) {
      throw new ConflictException(
        `Attempt is ${attempt.status}; only a timed-out or disputed attempt is reconciled by hand`,
      );
    }

    const claimed = await this.prisma.pspPaymentAttempt.updateMany({
      where: { id: attempt.id, status: attempt.status },
      data: {
        status: PspAttemptStatus.FAILED,
        resolutionBasis: PspResolutionBasis.MANUAL_RECONCILIATION,
        reconciledByUserId: params.reconciledByUserId,
        reconciliationCheckedByUserId: params.checkedByUserId,
        reconciliationEvidence: evidence,
        failureReason: `Reconciled by hand: ${evidence}`,
        liveKey: null,
        resolvedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('Attempt was resolved by someone else');
    }

    this.logger.warn(
      `PSP attempt ${attempt.id} released by manual reconciliation ` +
        `(${params.reconciledByUserId} / ${params.checkedByUserId}): ${evidence}`,
    );
    return this.prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }

  /**
   * Whether anything about this purchase means money may already have moved.
   * Used by cancellation, which must not let a customer walk away from a
   * purchase the provider is still holding.
   */
  async hasUnsafeAttempt(intentId: string, tx?: Tx): Promise<boolean> {
    const db = tx ?? this.prisma;
    const count = await db.pspPaymentAttempt.count({
      where: { purchaseIntentId: intentId, status: { in: [...MONEY_MAY_HAVE_MOVED] } },
    });
    return count > 0;
  }
}
