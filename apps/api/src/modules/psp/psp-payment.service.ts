import {
  BadRequestException,
  ConflictException,
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
  PurchaseIntentStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PurchaseIntentsService } from '../purchase-intents/purchase-intents.service';
import { MONEY_MAY_HAVE_MOVED } from './psp-attempt-safety';
import { PSP_ADAPTER, PspAdapter } from './psp-adapter.interface';

type Tx = Prisma.TransactionClient;

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
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
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
        where: { id: found.id, status: { in: [PspAttemptStatus.INITIATED, PspAttemptStatus.PENDING_CONFIRMATION] } },
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
        where: { id: attempt.id, status: { in: [PspAttemptStatus.INITIATED, PspAttemptStatus.PENDING_CONFIRMATION] } },
        data: {
          status: PspAttemptStatus.SUCCEEDED,
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
        throw new ConflictException('Attempt was resolved concurrently');
      }

      return { alreadySettled: false, attemptId: attempt.id, ledgerTransactionId: posted.id };
    });
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
