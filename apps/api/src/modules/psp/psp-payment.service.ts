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
import { PSP_ADAPTER, PspAdapter } from './psp-adapter.interface';

type Tx = Prisma.TransactionClient;

/**
 * Statuses in which the provider may already hold the customer's money.
 *
 * `EXPIRED` is in the list, and that is the point of the list. A timed-out
 * attempt feels like a failure and is not one: nothing authoritative said the
 * payment did not happen, so treating it as safe is how a customer ends up
 * paying twice. Only `FAILED` — an explicit provider denial — clears a
 * purchase for another route.
 */
const MONEY_MAY_HAVE_MOVED: readonly PspAttemptStatus[] = [
  PspAttemptStatus.INITIATED,
  PspAttemptStatus.PENDING_CONFIRMATION,
  PspAttemptStatus.SUCCEEDED,
  PspAttemptStatus.EXPIRED,
  PspAttemptStatus.REQUIRES_RECONCILIATION,
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

      if (!confirmation.amount.equals(attempt.amount)) {
        // The provider says a different number than the bill asked for.
        // Never reconciled automatically: an amount mismatch is either a
        // partial payment the platform does not support or tampering.
        await tx.pspPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: PspAttemptStatus.REQUIRES_RECONCILIATION,
            liveKey: null,
            failureReason: `Amount mismatch: expected ${attempt.amount.toFixed(4)}, provider said ${confirmation.amount.toFixed(4)}`,
            providerPayload: confirmation.raw as Prisma.InputJsonValue,
            resolvedAt: new Date(),
          },
        });
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
