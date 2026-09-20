import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BalanceTopUp,
  BalanceTopUpStatus,
  Currency,
  LedgerAccountType,
  PostingDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, parsePositiveMoney } from '../../common/utils/money';
import { AppConfig } from '../../config/configuration';
import { ALERT_CHANNEL, AlertChannel } from '../../infrastructure/alerts/alert-channel.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { BANK_TOPUP_ADAPTER, BankTopUpAdapter } from './bank-topup-adapter.interface';

type Tx = Prisma.TransactionClient;

/** Ledger kinds this service writes for the purchase-funding leg. One list, so nothing drifts. */
export const PREPAID_LEDGER_KINDS = {
  /** DEBIT available / CREDIT reserved — money spoken for by an open purchase. */
  hold: 'customer.prepaid.hold',
  /** The mirror image of a hold, via `LedgerService.reverse`. */
  holdReleased: 'customer.prepaid.hold_released',
  /** DEBIT reserved / CREDIT `PARTNER_PAYABLE` — the purchase confirmed; TuTak now owes the partner. */
  partnerFunding: 'partner.prepaid_funding',
  /** DEBIT `PARTNER_PAYABLE` / CREDIT available — a refund gives the customer's money back. */
  partnerFundingRefund: 'partner.prepaid_funding_refund',
} as const;

/**
 * The three numbers a customer's money splits into. `book = available +
 * reserved` by construction: the two accounts are the two halves of one
 * hold posting, so nothing can be in both or in neither.
 */
export interface CustomerBalanceDetail {
  available: string;
  reserved: string;
  book: string;
  currency: Currency;
}

/**
 * A customer's own stored-value balance — see `CUSTOMER_PREPAID_BALANCE`'s
 * docblock in schema.prisma and docs/ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md.
 * Everything here is deliberately shaped like `PaymentEngineService`
 * (claim-then-post, `IdempotencyService` plus a stored key on the row for
 * crash recovery, same account-funding posting shape) — a top-up is not a
 * new kind of money movement, it just credits a customer's own account
 * instead of a partner's.
 */
@Injectable()
export class CustomerBalanceService {
  private readonly logger = new Logger(CustomerBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(BANK_TOPUP_ADAPTER) private readonly bankAdapter: BankTopUpAdapter,
    @Inject(ALERT_CHANNEL) private readonly alerts: AlertChannel,
  ) {}

  topUpsEnabled(): boolean {
    return this.config.get('features.customerPrepaidTopUpEnabled', { infer: true });
  }

  /**
   * The second lock on the same door.
   *
   * `CustomerBalanceModule` already leaves the controller unregistered when
   * top-ups are off, so there is no route to call. This exists because a
   * module wiring is one edit away from being changed by someone who does
   * not know what this account is, and because the EV roaming path holds a
   * reference to this service already — the surface that can reach these
   * methods is wider than the HTTP one.
   *
   * Guards only the two methods that turn real money into balance. Reading a
   * balance and spending an existing one stay open on purpose: closing the
   * feature must not strand money customers already hold.
   */
  private assertTopUpsEnabled(): void {
    if (!this.config.get('features.customerPrepaidTopUpEnabled', { infer: true })) {
      throw new ForbiddenException(
        'Customer balance top-up is not enabled on this deployment',
      );
    }
  }

  async getBalance(userId: string, currency: Currency = Currency.AMD) {
    const account = await this.ledger.accountFor({
      type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE,
      userId,
      currency,
    });
    // Raw balance reads DEBIT-positive / CREDIT-negative, same as every
    // other account in this ledger (see `PARTNER_PAYABLE`'s own docblock) —
    // funding a top-up credits this account, so it is negative-or-zero by
    // construction. Negated here because this is the one account whose
    // number is also meant to read as "how much money do I have" outside
    // the ledger, not "how much does the platform owe."
    return { balance: account.balance.negated().toFixed(MONEY_SCALE), currency };
  }

  async initiateTopUp(userId: string, amountStr: string, idempotencyKey?: string) {
    this.assertTopUpsEnabled();
    const amount = parsePositiveMoney(amountStr, 'amount');
    if (!idempotencyKey) {
      return this.initiateTopUpOnce(userId, amount);
    }
    return this.idempotency.run(
      { scope: `balance-topup:${userId}`, key: idempotencyKey, request: { amount: amount.toString() } },
      () => this.initiateTopUpOnce(userId, amount, idempotencyKey),
    );
  }

  private async initiateTopUpOnce(userId: string, amount: Decimal, idempotencyKey?: string) {
    // Same reasoning as `PaymentEngineService.findByKey`: `IdempotencyRecord`
    // normally answers this and this branch never runs — it exists for the
    // case where the record was lost while the row it described survived.
    if (idempotencyKey) {
      const already = await this.prisma.balanceTopUp.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      if (already) return this.toResult(already);
    }

    // Handed to the adapter as *its* idempotency key even when the caller
    // sent none, so a retried adapter call (a timeout on our side, not the
    // bank's) still cannot double-initiate on their side.
    const adapterKey = idempotencyKey ?? randomUUID();
    const result = await this.bankAdapter.initiateTopUp({
      userId,
      amount,
      currency: Currency.AMD,
      idempotencyKey: adapterKey,
    });

    if (result.outcome === 'DECLINED') {
      const topUp = await this.prisma.balanceTopUp.create({
        data: {
          userId,
          amount,
          currency: Currency.AMD,
          status: BalanceTopUpStatus.DECLINED,
          declineReason: result.declineReason,
          idempotencyKey,
        },
      });
      return this.toResult(topUp);
    }

    const topUp = await this.prisma.balanceTopUp.create({
      data: {
        userId,
        amount,
        currency: Currency.AMD,
        status: BalanceTopUpStatus.PENDING,
        providerReference: result.providerReference,
        idempotencyKey,
      },
    });
    return this.toResult(topUp, result.redirectUrl);
  }

  // Same field-name-parity reasoning `EvSessionsService.stopOnce`'s two
  // branches follow: `redirectUrl` is present (typed `string | undefined`)
  // on every result, not only the branch that has one, so a caller never
  // has to narrow on `status` before touching a field it already knows is
  // there for the branch it is actually exercising.
  private toResult(topUp: BalanceTopUp, redirectUrl?: string) {
    return {
      topUpId: topUp.id,
      status: topUp.status,
      amount: topUp.amount.toFixed(MONEY_SCALE),
      declineReason: topUp.declineReason ?? undefined,
      redirectUrl,
    };
  }

  /**
   * Called from the provider-facing webhook route. Verification (signature,
   * reference lookup) is entirely the adapter's job — this method only
   * decides what a *verified* result does to the row and the ledger.
   */
  async confirmTopUpWebhook(
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    // Refused before the adapter is even asked. A deployment with top-ups
    // off has no pending top-up a webhook could legitimately complete, so
    // anything arriving here is either misrouted or probing.
    this.assertTopUpsEnabled();
    const verified = await this.bankAdapter.verifyTopUpWebhook(body, headers);
    if (!verified) {
      throw new BadRequestException('Could not verify this callback');
    }

    const topUp = await this.prisma.balanceTopUp.findUnique({
      where: { providerReference: verified.providerReference },
    });
    if (!topUp) {
      this.logger.warn(`Top-up webhook for unknown providerReference ${verified.providerReference}`);
      return;
    }
    // PENDING and UNRESOLVED are both "the provider has not told us yet".
    // A late answer to an UNRESOLVED top-up is the answer this whole state
    // exists to wait for, so it credits (or declines) exactly as a timely
    // one would — and exactly once, via the same conditional claim.
    const OPEN: BalanceTopUpStatus[] = [BalanceTopUpStatus.PENDING, BalanceTopUpStatus.UNRESOLVED];
    if (!OPEN.includes(topUp.status)) {
      // Already resolved — a replayed or duplicated webhook delivery is a
      // no-op, not a second credit.
      return;
    }

    if (verified.outcome !== 'COMPLETED') {
      await this.prisma.balanceTopUp.updateMany({
        where: { id: topUp.id, status: { in: OPEN } },
        data: {
          status: verified.outcome === 'DECLINED' ? BalanceTopUpStatus.DECLINED : BalanceTopUpStatus.FAILED,
          declineReason: verified.declineReason,
          resolvedAt: new Date(),
        },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // The conditional `updateMany` is the actual claim — two overlapping
      // webhook deliveries for the same top-up both reaching this point
      // must credit the balance exactly once. The loser sees `count === 0`
      // and does nothing further, the same idiom `EvSessionsService
      // .stopRoamingSession`'s `stoppedAt` claim and
      // `EvCdrReconciliationService`'s `reconcilingAt`/`settlingAt` claims
      // already use.
      const claimed = await tx.balanceTopUp.updateMany({
        where: { id: topUp.id, status: { in: OPEN } },
        data: { status: BalanceTopUpStatus.COMPLETED, resolvedAt: new Date() },
      });
      if (claimed.count === 0) return;

      const [pspAccount, balanceAccount] = await Promise.all([
        this.ledger.accountFor({ type: LedgerAccountType.PSP_RECEIVABLE, currency: topUp.currency }, tx),
        this.ledger.accountFor(
          { type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId: topUp.userId, currency: topUp.currency },
          tx,
        ),
      ]);

      // Same shape `PaymentEngineService.capture` posts for a partner
      // payment (DEBIT PSP_RECEIVABLE for the captured amount) — a top-up is
      // not a different kind of money coming in, it just credits the
      // customer's own account instead of a partner's, and reuses the same
      // acquirer-settlement pipeline (PSP_RECEIVABLE -> PLATFORM_BANK) that
      // already exists for draining it into real cash.
      const ledgerTransaction = await this.ledger.post(
        {
          kind: 'balance.topup.completed',
          sourceType: 'BalanceTopUp',
          sourceId: topUp.id,
          currency: topUp.currency,
          postings: [
            { accountId: pspAccount.id, direction: PostingDirection.DEBIT, amount: topUp.amount },
            { accountId: balanceAccount.id, direction: PostingDirection.CREDIT, amount: topUp.amount },
          ],
        },
        tx,
      );

      await tx.balanceTopUp.update({
        where: { id: topUp.id },
        data: { ledgerTransactionId: ledgerTransaction.id },
      });
    });
  }

  /**
   * What the customer's app may believe about one top-up. Their own rows
   * only — a top-up id is not a capability.
   *
   * `UNRESOLVED` is returned as itself, never mapped to anything friendlier:
   * the app's job is to say "we are checking with the provider", and a
   * status that read DECLINED or PENDING here would let it say something
   * false.
   */
  async getTopUpStatus(userId: string, topUpId: string) {
    const topUp = await this.prisma.balanceTopUp.findFirst({ where: { id: topUpId, userId } });
    if (!topUp) throw new NotFoundException('Top-up not found');
    return {
      topUpId: topUp.id,
      status: topUp.status,
      amount: topUp.amount.toFixed(MONEY_SCALE),
      currency: topUp.currency,
      declineReason: topUp.declineReason ?? undefined,
      createdAt: topUp.createdAt,
      resolvedAt: topUp.resolvedAt,
    };
  }

  /**
   * Time makes an unanswered top-up louder; it never decides it.
   *
   * Step 1: a PENDING top-up older than `topUpStaleAfterMs` becomes
   * UNRESOLVED — a state, not an outcome. The customer may have paid; the
   * provider has not said. Step 2: every UNRESOLVED top-up is alerted on
   * once per `topUpEscalateEveryMs` until the provider's webhook or an
   * operator with the provider's statement closes it. Same shape and same
   * reasoning as `PspAttemptAgeingService.escalateStaleAttempts`.
   *
   * Runs whether or not top-ups are enabled: a deployment that turned the
   * feature off with a PENDING row still open must not stop watching it.
   */
  async escalateStaleTopUps(): Promise<{ marked: number; escalated: number }> {
    const { topUpStaleAfterMs, topUpEscalateEveryMs } = this.config.get('customerBalance', {
      infer: true,
    });
    const now = Date.now();

    const stale = await this.prisma.balanceTopUp.findMany({
      where: { status: BalanceTopUpStatus.PENDING, createdAt: { lt: new Date(now - topUpStaleAfterMs) } },
      select: { id: true },
    });
    let marked = 0;
    for (const row of stale) {
      // Conditional on still being PENDING: a webhook may have landed
      // between the read and this write, and a webhook beats a clock.
      const claimed = await this.prisma.balanceTopUp.updateMany({
        where: { id: row.id, status: BalanceTopUpStatus.PENDING },
        data: { status: BalanceTopUpStatus.UNRESOLVED, unresolvedAt: new Date() },
      });
      marked += claimed.count;
    }

    const unresolved = await this.prisma.balanceTopUp.findMany({
      where: {
        status: BalanceTopUpStatus.UNRESOLVED,
        OR: [{ escalatedAt: null }, { escalatedAt: { lt: new Date(now - topUpEscalateEveryMs) } }],
      },
      select: {
        id: true,
        userId: true,
        amount: true,
        currency: true,
        providerReference: true,
        createdAt: true,
        escalationCount: true,
      },
    });
    let escalated = 0;
    for (const row of unresolved) {
      const claimed = await this.prisma.balanceTopUp.updateMany({
        where: {
          id: row.id,
          status: BalanceTopUpStatus.UNRESOLVED,
          OR: [{ escalatedAt: null }, { escalatedAt: { lt: new Date(now - topUpEscalateEveryMs) } }],
        },
        data: { escalatedAt: new Date(), escalationCount: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      escalated += 1;
      const ageMinutes = Math.round((now - row.createdAt.getTime()) / 60_000);
      // Never the secret, never the customer's phone: the id, the amount
      // and the provider's own reference are what an operator needs to
      // look it up on the provider's side.
      await this.alerts.send({
        severity: row.escalationCount === 0 ? 'warning' : 'critical',
        title: `Customer top-up unresolved for ${ageMinutes} min`,
        body:
          `Top-up ${row.id} (${row.amount.toFixed(MONEY_SCALE)} ${row.currency}, provider ref ` +
          `${row.providerReference ?? '—'}) has had no authoritative answer from the provider. ` +
          'The customer may have paid. Check the provider statement; do not credit by hand.',
        key: `balance.topup.unresolved:${row.id}:${row.escalationCount + 1}`,
        context: { topUpId: row.id, userId: row.userId, escalation: row.escalationCount + 1 },
      });
    }
    return { marked, escalated };
  }

  /**
   * Whether purchases may draw on stored balances at all. Separate from the
   * top-up gate on purpose — see `features.customerPrepaidPurchaseEnabled`.
   */
  purchasesEnabled(): boolean {
    return this.config.get('features.customerPrepaidPurchaseEnabled', { infer: true });
  }

  private assertPurchasesEnabled(): void {
    if (!this.purchasesEnabled()) {
      throw new ForbiddenException(
        'Paying from a stored balance is not enabled on this deployment',
      );
    }
  }

  /**
   * Available, reserved and book balance — the figures the checkout quote
   * and the wallet screen show. Both accounts are credit-normal (see the
   * enum's docblock), negated here so the customer reads "how much I have"
   * and "how much is spoken for". `tx` for a caller inside its own
   * transaction; the default is a plain read.
   */
  async getBalanceDetail(
    userId: string,
    currency: Currency = Currency.AMD,
    tx?: Tx,
  ): Promise<CustomerBalanceDetail> {
    const [available, reserved] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId, currency }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.CUSTOMER_PREPAID_RESERVED, userId, currency }, tx),
    ]);
    const availableAmount = available.balance.negated();
    const reservedAmount = reserved.balance.negated();
    return {
      available: availableAmount.toFixed(MONEY_SCALE),
      reserved: reservedAmount.toFixed(MONEY_SCALE),
      book: availableAmount.plus(reservedAmount).toFixed(MONEY_SCALE),
      currency,
    };
  }

  /**
   * Speaks for `amount` of the customer's money on behalf of a purchase that
   * is being opened, inside the caller's transaction.
   *
   * ## The guarantee
   *
   * Two purchases opened at the same instant against one balance of 45 000
   * for 45 000 each: exactly one gets a hold. The claim is a single
   * conditional `UPDATE ... WHERE balance <= -amount` on the *available*
   * account's row — the same idiom `collectFromBalance` uses, and the one
   * `LedgerService.applyNetDeltas` explains at length. The second
   * transaction blocks on the row until the first commits, re-evaluates the
   * predicate against the debited balance, and matches zero rows. No
   * `SELECT ... FOR UPDATE`, no Serializable retry loop, no application-side
   * arithmetic on a snapshot that could be stale.
   *
   * ## Why it is one posting and not a column
   *
   * DEBIT available / CREDIT reserved: the money leaves the number the
   * customer may spend the moment the purchase opens (so `available` can
   * never go negative, and a second purchase cannot see money the first one
   * already claimed), and it lands in an account rather than vanishing, so
   * `book` is unchanged and every dram is still on a balanced ledger. The
   * hold can later be *reversed* — its exact mirror, exactly once — or
   * *settled* into `PARTNER_PAYABLE`, and nothing else; there is no third
   * exit for reserved money.
   *
   * Returns the hold's ledger transaction, which the purchase row stores as
   * `prepaidHoldTransactionId`. Throws `BadRequestException` when the
   * balance cannot cover the amount, and the caller's transaction is left
   * to roll back with it — a purchase that could not be funded is never
   * created.
   */
  async holdForPurchase(
    params: { userId: string; amount: Decimal; purchaseIntentId: string; currency?: Currency },
    tx: Tx,
  ): Promise<{ id: string }> {
    this.assertPurchasesEnabled();
    const currency = params.currency ?? Currency.AMD;
    if (params.amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('prepaidAmountApplied must be positive to hold');
    }

    const availableAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId: params.userId, currency },
      tx,
    );
    const claimed = await tx.ledgerAccount.updateMany({
      where: { id: availableAccount.id, balance: { lte: params.amount.negated() } },
      data: { version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('Insufficient available balance');
    }

    const reservedAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.CUSTOMER_PREPAID_RESERVED, userId: params.userId, currency },
      tx,
    );
    const hold = await this.ledger.post(
      {
        kind: PREPAID_LEDGER_KINDS.hold,
        sourceType: 'PurchaseIntent',
        sourceId: params.purchaseIntentId,
        currency,
        postings: [
          { accountId: availableAccount.id, direction: PostingDirection.DEBIT, amount: params.amount },
          { accountId: reservedAccount.id, direction: PostingDirection.CREDIT, amount: params.amount },
        ],
      },
      tx,
    );
    return { id: hold.id };
  }

  /**
   * Gives a held amount back to the customer's available balance — the
   * purchase was cancelled, rejected or expired. The mirror image of the hold
   * posting, written by `LedgerService.reverse`, whose unique `reversesId`
   * makes a second release of the same hold a constraint violation rather
   * than a second credit. Callers run this inside the same transaction as
   * the status flip that authorises it, so a crash between the two is not a
   * reachable state.
   *
   * Deliberately *not* gated on `purchasesEnabled`: turning the feature off
   * must never strand a customer's money in `RESERVED`.
   */
  async releaseHold(holdTransactionId: string, tx: Tx): Promise<void> {
    await this.ledger.reverse(holdTransactionId, PREPAID_LEDGER_KINDS.holdReleased, tx);
  }

  /**
   * The purchase confirmed: the reserved money is now owed to the partner.
   * DEBIT `CUSTOMER_PREPAID_RESERVED` (the hold is spent) / CREDIT
   * `PARTNER_PAYABLE` (TuTak owes the partner that much more). Posted inside
   * the purchase's own settlement transaction, next to the contribution and
   * bonus-compensation postings, so the three commit or roll back together.
   *
   * This is the *only* posting that makes external-vs-TuTak money differ in
   * the partner's ledger: cash at the till posts nothing, bonus posts the
   * existing redemption compensation, and prepaid posts this. Everything
   * else about the purchase's economics is identical whichever way it was
   * funded.
   *
   * Not gated on `purchasesEnabled` either: a purchase that was allowed to
   * open must be allowed to close.
   */
  async settleHoldToPartner(
    params: { userId: string; partnerId: string; amount: Decimal; purchaseIntentId: string; currency?: Currency },
    tx: Tx,
  ): Promise<{ id: string }> {
    const currency = params.currency ?? Currency.AMD;
    const [reservedAccount, partnerAccount] = await Promise.all([
      this.ledger.accountFor(
        { type: LedgerAccountType.CUSTOMER_PREPAID_RESERVED, userId: params.userId, currency },
        tx,
      ),
      this.ledger.accountFor(
        { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: params.partnerId, currency },
        tx,
      ),
    ]);
    const posted = await this.ledger.post(
      {
        kind: PREPAID_LEDGER_KINDS.partnerFunding,
        sourceType: 'PurchaseIntent',
        sourceId: params.purchaseIntentId,
        currency,
        postings: [
          { accountId: reservedAccount.id, direction: PostingDirection.DEBIT, amount: params.amount },
          { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: params.amount },
        ],
      },
      tx,
    );
    return { id: posted.id };
  }

  /**
   * A refund returns part of the prepaid component to the customer's
   * available balance and takes it back from the partner: DEBIT
   * `PARTNER_PAYABLE` / CREDIT `CUSTOMER_PREPAID_BALANCE`. A new posting,
   * never an edit of `partner.prepaid_funding`, so a refund after the
   * partner has already been paid simply leaves a fresh unclaimed debit for
   * the next settlement — or a collection — to pick up.
   */
  async refundPrepaidFromPartner(
    params: { userId: string; partnerId: string; amount: Decimal; purchaseIntentId: string; currency?: Currency },
    tx: Tx,
  ): Promise<{ id: string }> {
    const currency = params.currency ?? Currency.AMD;
    const [availableAccount, partnerAccount] = await Promise.all([
      this.ledger.accountFor(
        { type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId: params.userId, currency },
        tx,
      ),
      this.ledger.accountFor(
        { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: params.partnerId, currency },
        tx,
      ),
    ]);
    const posted = await this.ledger.post(
      {
        kind: PREPAID_LEDGER_KINDS.partnerFundingRefund,
        sourceType: 'PurchaseIntent',
        sourceId: params.purchaseIntentId,
        currency,
        postings: [
          { accountId: partnerAccount.id, direction: PostingDirection.DEBIT, amount: params.amount },
          { accountId: availableAccount.id, direction: PostingDirection.CREDIT, amount: params.amount },
        ],
      },
      tx,
    );
    return { id: posted.id };
  }

  /**
   * Spends a customer's prepaid balance against an app-initiated roaming
   * session's cost the moment it settles
   * (`EvCdrReconciliationService.completeAppInitiatedSession`) — the actual
   * collection mechanism `EV_ROAMING_RECEIVABLE`'s own docblock names.
   *
   * All-or-nothing on purpose: it collects the full `cost` if the balance
   * covers it, or nothing at all otherwise, rather than a partial amount.
   * A partial-collection semantic (collect what's there, leave the rest on
   * the receivable) has no product requirement behind it yet and would
   * trade this method's current one-statement safety for a more complex,
   * unrequested feature — a customer with insufficient balance is entirely
   * unaffected by this method existing, exactly as before it was written.
   *
   * Returns whether it collected. Idempotent on `sourceTransactionId`, and
   * safe to call from outside the settlement's own atomic transaction — see
   * the call site's own reasoning for why it deliberately is.
   *
   * Until 20.09.2026 this was the *only* place anything ever debited
   * `CUSTOMER_PREPAID_BALANCE` (closed-loop decision of 2026-08-29). The
   * owner's hybrid-payment brief revisited that decision explicitly:
   * `holdForPurchase` above is the second — and, with it, the last — way to
   * spend this account. Still no conversion into bonus/wallet points; see
   * the enum's own schema docblock for the current list.
   */
  async collectFromBalance(
    userId: string,
    cost: Decimal,
    currency: Currency,
    sourceTransactionId: string,
  ): Promise<boolean> {
    if (cost.lessThanOrEqualTo(0)) return false;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerTransaction.findFirst({
        where: { kind: 'ev.roaming.balance_collection', sourceType: 'Transaction', sourceId: sourceTransactionId },
        select: { id: true },
      });
      if (existing) return false;

      const balanceAccount = await this.ledger.accountFor(
        { type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId, currency },
        tx,
      );

      // The guard: claims the account's row conditionally on there being
      // enough to cover `cost` — the same idiom `RefundEngineService` uses
      // to cap a refund at what was actually captured (a conditional
      // `updateMany`, not a separate `SELECT ... FOR UPDATE` — see
      // `LedgerService.applyNetDeltas`'s own docblock for why the latter is
      // deliberately avoided elsewhere in this ledger). A concurrent attempt
      // against the same account either waits for this transaction to
      // commit and then sees the debited balance, or — if it runs first —
      // leaves this one with `claimed.count === 0`, collecting nothing
      // rather than oversubscribing. `ledger.post` below is what actually
      // records the move and keeps the account reconstructable from its own
      // postings; this step only decides whether it is safe to.
      //
      // `balance <= -cost`, not `balance >= cost`: this account is credited
      // to fund it, so a funded balance is negative-or-zero (see its own
      // schema docblock) — "at least `cost` available" reads as "at most
      // `-cost`" in the account's own raw units.
      const claimed = await tx.ledgerAccount.updateMany({
        where: { id: balanceAccount.id, balance: { lte: cost.negated() } },
        data: { version: { increment: 1 } },
      });
      if (claimed.count === 0) return false;

      const receivableAccount = await this.ledger.accountFor(
        { type: LedgerAccountType.EV_ROAMING_RECEIVABLE, currency },
        tx,
      );

      await this.ledger.post(
        {
          kind: 'ev.roaming.balance_collection',
          sourceType: 'Transaction',
          sourceId: sourceTransactionId,
          currency,
          postings: [
            { accountId: balanceAccount.id, direction: PostingDirection.DEBIT, amount: cost },
            { accountId: receivableAccount.id, direction: PostingDirection.CREDIT, amount: cost },
          ],
        },
        tx,
      );
      return true;
    });
  }
}
