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
  PspCallbackKind,
  PspInboxStatus,
  PostingDirection,
  Prisma,
  PspAttemptStatus,
  PspResolutionBasis,
  PurchaseIntentStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PurchaseIntentsService } from '../purchase-intents/purchase-intents.service';
import { MONEY_MAY_HAVE_MOVED } from './psp-attempt-safety';
import { PSP_ADAPTER, PspAdapter } from './psp-adapter.interface';

type Tx = Prisma.TransactionClient;

/**
 * What a customer may be told about their own payment.
 *
 * Every value here is derived from this platform's own records. None of it
 * comes from a redirect: `SUCCESS_URL` and `FAIL_URL` move a browser, and a
 * browser arriving somewhere is not evidence that money did.
 */
export type CustomerPaymentProgress =
  | { state: 'NOT_APPLICABLE' }
  | { state: 'NOT_STARTED' }
  /** A bill is open and the provider has told us nothing yet. */
  | { state: 'WAITING_PROVIDER'; attemptId: string }
  /** A verified confirmation is in hand; its effects are being applied. */
  | { state: 'PROCESSING'; attemptId: string }
  | { state: 'SUCCEEDED'; attemptId: string }
  /** The provider said, authoritatively, that no money moved. */
  | { state: 'FAILED'; attemptId: string }
  /**
   * The platform stopped waiting and nothing authoritative has said whether
   * the money moved (audit 21.09.2026, D06). Not `WAITING_PROVIDER`: nobody
   * is waiting for the provider's page any more, and telling the customer
   * so is what keeps them from paying at the till on top. Not
   * `REQUIRES_RECONCILIATION` either: no person has been asked yet; the
   * ageing sweep escalates it there.
   */
  | { state: 'UNRESOLVED'; attemptId: string }
  /** Nobody can say yet. A human is looking. */
  | { state: 'REQUIRES_RECONCILIATION'; attemptId: string };

/**
 * Why a begin call would be refused right now. Mirrors, in order, the checks
 * `beginAttempt` makes — this is the same decision previewed, not a second
 * opinion. `beginAttempt` still checks for itself: the preview is what the
 * app shows, the call is what the app gets.
 */
export type CustomerPaymentBlockReason =
  | 'NOT_ROUTED'
  | 'PROVIDER_DISABLED'
  | 'PURCHASE_NOT_OPEN'
  | 'NOTHING_TO_COLLECT'
  | 'AWAITING_MERCHANT_APPROVAL'
  | 'UNRESOLVED_ATTEMPT';

export type CustomerPaymentStatus = CustomerPaymentProgress & {
  purchaseStatus: PurchaseIntentStatus;
  canBeginPayment: boolean;
  reason: CustomerPaymentBlockReason | null;
};

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
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(PSP_ADAPTER) private readonly adapter: PspAdapter,
  ) {}

  /**
   * Refuses anything that could put a customer in front of a real payment
   * form while paying inside TuTak is switched off.
   *
   * ## Why this is not redundant with the check at purchase creation
   *
   * It was, until a purchase outlived the flag. `PurchaseIntentsService
   * .create` refuses to *make* a provider-routed purchase when the flag is
   * off — but rows created while it was on, restored from a backup, seeded,
   * or written by a migration are still there, still `AWAITING_CONFIRMATION`,
   * and `beginAttempt` was happy to open a real bill against one.
   *
   * What made that dangerous rather than merely untidy: the callback worker
   * *does* check the flag. So the customer would have paid real money into
   * the merchant account and the platform would have refused to settle it —
   * charged, nothing delivered, and the row sitting in the inbox unprocessed.
   * Of the ways this could go wrong, that is the worst one.
   *
   * ## Why the adapter's missing credentials were not the gate
   *
   * `IdramAdapter.createBill` throws without `IDRAM_MERCHANT_ID` and
   * `IDRAM_SECRET_KEY`, which is why this never fired in practice. That is a
   * configuration accident, not a control: it disappears the moment somebody
   * stages credentials ahead of activation, which is exactly what a careful
   * person does the day before turning the flag on. The regression test sets
   * the credentials on purpose so the flag is the only thing standing there.
   */
  private assertProviderPaymentsEnabled(): void {
    if (!this.config.get('features.tutakPspEnabled', { infer: true })) {
      throw new ConflictException('Paying inside TuTak is not available yet');
    }
  }

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
    this.assertProviderPaymentsEnabled();

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

    /*
     * Configuration first, then the bill, then the row — in that order.
     *
     * The first version wrote the `INITIATED` attempt and *then* asked the
     * adapter for the bill. When the adapter threw on a missing merchant id,
     * the attempt stayed behind: an unsafe, unresolved row that blocked the
     * customer from paying again until a human reconciled a payment that had
     * never been offered. A local misconfiguration became a stranded
     * customer.
     *
     * `assertReady` fails closed with nothing written. `createBill` is local
     * for the documented Idram flow (it builds a form; see the interface),
     * so calling it before the insert leaves nothing behind if it throws for
     * any other reason either. The insert is the only side effect, and it is
     * last.
     */
    this.adapter.assertReady();

    const billId = randomUUID();
    const bill = await this.adapter.createBill({
      billId,
      amount: intent.ordinaryPaymentRemainder,
      currency: 'AMD',
      description: `TuTak purchase ${intent.id}`,
    });

    let attempt;
    try {
      attempt = await this.prisma.pspPaymentAttempt.create({
        data: {
          purchaseIntentId: intent.id,
          provider: this.adapter.name,
          status: PspAttemptStatus.INITIATED,
          amount: intent.ordinaryPaymentRemainder,
          providerBillId: bill.providerBillId || billId,
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

    // The handoff is passed outwards, which it previously was not: the form
    // fields Idram's documented flow needs were computed and then dropped,
    // so no client could actually perform the flow. Returned as a typed
    // `ProviderHandoff` rather than as `raw`, so a redirect provider and a
    // form-post provider are the same contract to the caller.
    return { attemptId: attempt.id, billId, handoff: bill.handoff };
  }

  /**
   * Answer a provider's pre-check: "does this bill exist and may it be paid?"
   *
   * **Nothing here touches the ledger, and nothing may.** A pre-check is the
   * provider asking before it takes money; treating it as a payment would
   * credit a partner for a sale the customer has not yet made, and answering
   * it ten times must therefore cost exactly nothing ten times.
   *
   * What it does check is everything that would make the payment wrong:
   * that the bill is one we opened, that the merchant account is ours, that
   * the amount is the amount we asked for, and that the purchase is still in
   * a state that may be paid. A pre-check on an expired attempt or a
   * cancelled purchase is refused here rather than being allowed to become a
   * payment we then have to reverse.
   */
  async answerPrecheck(body: unknown): Promise<{ ok: boolean; reason?: string }> {
    // A pre-check asks "may this bill be paid?". With the route switched off
    // the answer is no, whatever the bill says — and answering `ok` would
    // invite the provider to take the money next.
    if (!this.config.get('features.tutakPspEnabled', { infer: true })) {
      return { ok: false, reason: 'provider payments are disabled' };
    }
    const request = this.adapter.readPrecheck(body);

    if (!request.billId) return { ok: false, reason: 'no bill' };
    // Whose bill this is. A pre-check quoting a different merchant account
    // is either misrouted or probing, and "yes" would tell the provider to
    // take money for a bill we did not open. Nothing financial happens on
    // this path either way — the only effect of a pre-check is the answer.
    if (!request.merchantMatches) return { ok: false, reason: 'merchant mismatch' };

    const attempt = await this.prisma.pspPaymentAttempt.findFirst({
      where: { provider: this.adapter.name, providerBillId: request.billId },
      include: {
        purchaseIntent: {
          select: { id: true, status: true, merchantApprovedAt: true, expiresAt: true },
        },
      },
    });
    if (!attempt) return { ok: false, reason: 'unknown bill' };

    if (!CONFIRMABLE.includes(attempt.status)) {
      return { ok: false, reason: `attempt is ${attempt.status}` };
    }
    if (request.amount === null || !request.amount.equals(attempt.amount)) {
      this.logger.warn(
        `Idram pre-check for bill ${request.billId} quoted ${request.amount?.toFixed(2) ?? '—'}, ` +
          `bill is ${attempt.amount.toFixed(2)} — refused`,
      );
      return { ok: false, reason: 'amount mismatch' };
    }
    if (attempt.purchaseIntent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      return { ok: false, reason: `purchase is ${attempt.purchaseIntent.status}` };
    }
    if (!attempt.purchaseIntent.merchantApprovedAt) {
      return { ok: false, reason: 'purchase not approved by the merchant' };
    }

    return { ok: true };
  }

  /**
   * What the customer's app should show about their payment.
   *
   * Deliberately derived from the attempt and the purchase, never from where
   * the provider's browser redirect landed. A customer arriving at a success
   * URL proves that a browser followed a redirect and nothing about money;
   * this is the only thing the app is allowed to believe.
   */
  async customerPaymentStatus(
    purchaseIntentId: string,
    customerId: string,
  ): Promise<CustomerPaymentStatus> {
    const intent = await this.prisma.purchaseIntent.findUnique({
      where: { id: purchaseIntentId },
      select: {
        id: true,
        customerId: true,
        status: true,
        paymentRoute: true,
        merchantApprovedAt: true,
        ordinaryPaymentRemainder: true,
      },
    });
    if (!intent || intent.customerId !== customerId) {
      throw new NotFoundException('Purchase not found');
    }

    const progress = await this.paymentProgress(intent);
    const reason = await this.beginBlockReason(intent);
    return {
      ...progress,
      purchaseStatus: intent.status,
      canBeginPayment: reason === null,
      reason,
    };
  }

  /**
   * The same questions `beginAttempt` asks, in the same order, answered
   * without side effects.
   *
   * Before this existed the app's only way to learn *why* it could not pay
   * was to try and be refused — and it then told every customer the cashier
   * had not agreed the amount, whatever the actual refusal said. A purchase
   * that expired, a provider switched off, an earlier attempt that may hold
   * the money: all of them read as "waiting for the cashier".
   */
  private async beginBlockReason(intent: {
    id: string;
    status: PurchaseIntentStatus;
    paymentRoute: PaymentRoute;
    merchantApprovedAt: Date | null;
    ordinaryPaymentRemainder: Prisma.Decimal;
  }): Promise<CustomerPaymentBlockReason | null> {
    if (intent.paymentRoute !== PaymentRoute.TUTAK_PSP) return 'NOT_ROUTED';
    if (!this.config.get('features.tutakPspEnabled', { infer: true })) {
      return 'PROVIDER_DISABLED';
    }
    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) return 'PURCHASE_NOT_OPEN';
    if (intent.ordinaryPaymentRemainder.lessThanOrEqualTo(0)) return 'NOTHING_TO_COLLECT';
    if (!intent.merchantApprovedAt) return 'AWAITING_MERCHANT_APPROVAL';
    if (await this.hasUnsafeAttempt(intent.id)) return 'UNRESOLVED_ATTEMPT';
    return null;
  }

  private async paymentProgress(intent: {
    id: string;
    status: PurchaseIntentStatus;
    paymentRoute: PaymentRoute;
  }): Promise<CustomerPaymentProgress> {
    if (intent.paymentRoute !== PaymentRoute.TUTAK_PSP) {
      return { state: 'NOT_APPLICABLE' };
    }

    const attempt = await this.prisma.pspPaymentAttempt.findFirst({
      where: { purchaseIntentId: intent.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, providerBillId: true },
    });
    if (!attempt) return { state: 'NOT_STARTED' };

    if (attempt.status === PspAttemptStatus.SUCCEEDED) {
      // Only once the purchase itself is confirmed. The two commit together,
      // so a gap here means something is wrong, not that it is nearly done.
      return intent.status === PurchaseIntentStatus.CONFIRMED
        ? { state: 'SUCCEEDED', attemptId: attempt.id }
        : { state: 'PROCESSING', attemptId: attempt.id };
    }
    if (attempt.status === PspAttemptStatus.FAILED) {
      return { state: 'FAILED', attemptId: attempt.id };
    }
    if (attempt.status === PspAttemptStatus.REQUIRES_RECONCILIATION) {
      return { state: 'REQUIRES_RECONCILIATION', attemptId: attempt.id };
    }

    // A verified callback is in the inbox but its money has not moved yet.
    // Worth distinguishing: "we have your payment and are finishing up" is a
    // different thing to tell somebody than "we are still waiting for you".
    const queued = await this.prisma.pspCallbackInbox.count({
      where: {
        billId: attempt.providerBillId,
        kind: PspCallbackKind.FINAL,
        verified: true,
        status: { in: [PspInboxStatus.RECEIVED, PspInboxStatus.PROCESSING] },
      },
    });
    if (queued > 0) return { state: 'PROCESSING', attemptId: attempt.id };

    if (attempt.status === PspAttemptStatus.EXPIRED) {
      return { state: 'UNRESOLVED', attemptId: attempt.id };
    }
    return { state: 'WAITING_PROVIDER', attemptId: attempt.id };
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
      /*
       * Take the attempt row's lock before doing anything expensive.
       *
       * `SELECT ... FOR UPDATE` is what turns N duplicate deliveries of one
       * callback into one worker and N-1 cheap replays. Without it all N
       * raced through the whole settlement — ledger postings, bonus lots,
       * referral legs — and then N-1 discovered at the very last statement
       * that somebody else had claimed the attempt, and threw away all of
       * that work. That is not merely wasteful: N transactions each holding
       * locks on the same wallet, accounts and purchase, acquired in whatever
       * order they happened to get there, is how a deadlock is built.
       *
       * Here the only contention is this one row. The winner settles; the
       * others wait on the lock, see `SUCCEEDED` the moment it commits, and
       * return the replay answer without touching money. It is the same
       * claim-then-act shape the rest of this codebase uses, moved to the
       * front where it belongs.
       *
       * The conditional claim at the end of the transaction is *not* removed
       * on the strength of this lock. It stays as the authority on who won,
       * because it also guards `resolutionBasis` — a human reconciliation may
       * have answered this attempt between the lock and the claim.
       */
      await tx.$queryRaw`
        SELECT id FROM "psp_payment_attempts"
         WHERE provider = ${this.adapter.name}
           AND "providerBillId" = ${confirmation.billId}
           FOR UPDATE
      `;

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

      // Both on `tx`, like every other account lookup in this settlement.
      // A tx-less lookup here borrows a second pool connection while this
      // transaction holds one, which is exactly how a burst of duplicate
      // callbacks used to exhaust the pool and roll every settlement back.
      const receivable = await this.ledger.accountFor(
        { type: LedgerAccountType.PSP_RECEIVABLE },
        tx,
      );
      const payable = await this.ledger.accountFor(
        { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: attempt.purchaseIntent.partnerId },
        tx,
      );

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
   * One person reads the provider's record and says what it shows. Changes
   * nothing.
   *
   * The only way an `EXPIRED` or `REQUIRES_RECONCILIATION` attempt is ever
   * released, short of the provider itself answering — and it takes two
   * people to finish, in two separate authenticated calls.
   *
   * It used to be one call taking two user ids, which is not dual control:
   * the second person existed only as a string the first one typed. Arman's
   * decision of 15.09.2026 is explicit that one HTTP caller cannot supply the
   * identity of the second human, so the proposal is persisted on its own and
   * `confirmManualReconciliation` is a separate request by a separate
   * authenticated actor.
   */
  async proposeManualReconciliation(params: {
    attemptId: string;
    actorId: string;
    evidence: string;
  }) {
    const evidence = params.evidence.trim();
    if (!evidence) {
      throw new BadRequestException(
        'Say what the provider\u2019s record shows \u2014 evidence is required',
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

    await this.prisma.pspPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        reconciledByUserId: params.actorId,
        reconciliationEvidence: evidence,
        reconciliationProposedAt: new Date(),
        // A fresh proposal clears any earlier confirmation attempt's mark:
        // nothing may be confirmed that has not been proposed since.
        reconciliationCheckedByUserId: null,
      },
    });

    this.logger.warn(
      `Manual reconciliation proposed for attempt ${attempt.id} by ${params.actorId}: ${evidence}`,
    );
    return this.prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }

  /**
   * A second person agrees, and only now is the payment released.
   *
   * This is the act that makes the purchase free again: `hasUnsafeAttempt`
   * goes false, a new payment may be started, and the customer may buy at
   * that business again. That is why the bar is two authenticated people and
   * a written reason rather than a confirmation dialog.
   *
   * What it never does is mark an attempt `SUCCEEDED`. Money arriving is
   * established by a verified provider callback and by nothing else — a
   * human asserting that a payment worked would post to the ledger on
   * somebody’s word, which is the one thing this module exists to prevent.
   * There is no method for it and the table refuses the shape.
   */
  async confirmManualReconciliation(params: { attemptId: string; actorId: string }) {
    const attempt = await this.prisma.pspPaymentAttempt.findUnique({
      where: { id: params.attemptId },
    });
    if (!attempt) throw new NotFoundException('Payment attempt not found');
    if (!attempt.reconciliationProposedAt || !attempt.reconciledByUserId) {
      throw new ConflictException('Nobody has proposed what the provider\u2019s record shows yet');
    }
    if (attempt.reconciledByUserId === params.actorId) {
      throw new ForbiddenException(
        'You proposed this reconciliation; a second person has to confirm it',
      );
    }
    if (
      attempt.status !== PspAttemptStatus.EXPIRED &&
      attempt.status !== PspAttemptStatus.REQUIRES_RECONCILIATION
    ) {
      throw new ConflictException(`Attempt is ${attempt.status}; it is already resolved`);
    }

    const claimed = await this.prisma.pspPaymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: attempt.status,
        // Pinned to the proposal that was read: if somebody re-proposed in
        // between, this confirmation is of a reading nobody made.
        reconciliationProposedAt: attempt.reconciliationProposedAt,
      },
      data: {
        status: PspAttemptStatus.FAILED,
        resolutionBasis: PspResolutionBasis.MANUAL_RECONCILIATION,
        reconciliationCheckedByUserId: params.actorId,
        failureReason: `Reconciled by hand: ${attempt.reconciliationEvidence}`,
        liveKey: null,
        resolvedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('Attempt was resolved or re-proposed by someone else');
    }

    this.logger.warn(
      `PSP attempt ${attempt.id} released by manual reconciliation ` +
        `(${attempt.reconciledByUserId} / ${params.actorId}): ${attempt.reconciliationEvidence}`,
    );
    return this.prisma.pspPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }

  /** Attempts nobody can account for, for the finance queue. */
  async unresolvedAttempts() {
    return this.prisma.pspPaymentAttempt.findMany({
      where: {
        status: {
          in: [
            PspAttemptStatus.INITIATED,
            PspAttemptStatus.PENDING_CONFIRMATION,
            PspAttemptStatus.EXPIRED,
            PspAttemptStatus.REQUIRES_RECONCILIATION,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        purchaseIntent: {
          select: { id: true, partnerId: true, customerId: true, grossAmount: true, status: true },
        },
      },
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
