import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { BalanceTopUp, BalanceTopUpStatus, Currency, LedgerAccountType, PostingDirection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { BANK_TOPUP_ADAPTER, BankTopUpAdapter } from './bank-topup-adapter.interface';

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
    @Inject(BANK_TOPUP_ADAPTER) private readonly bankAdapter: BankTopUpAdapter,
  ) {}

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
    if (topUp.status !== BalanceTopUpStatus.PENDING) {
      // Already resolved — a replayed or duplicated webhook delivery is a
      // no-op, not a second credit.
      return;
    }

    if (verified.outcome !== 'COMPLETED') {
      await this.prisma.balanceTopUp.updateMany({
        where: { id: topUp.id, status: BalanceTopUpStatus.PENDING },
        data: {
          status: verified.outcome === 'DECLINED' ? BalanceTopUpStatus.DECLINED : BalanceTopUpStatus.FAILED,
          declineReason: verified.declineReason,
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
        where: { id: topUp.id, status: BalanceTopUpStatus.PENDING },
        data: { status: BalanceTopUpStatus.COMPLETED },
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
   * This is the *only* place anything ever debits `CUSTOMER_PREPAID_BALANCE`
   * — a closed-loop business decision (2026-08-29): this money pays for
   * roaming-CPO charging and nothing else, deliberately with no conversion
   * into bonus/wallet points, which are spendable anywhere a purchase
   * accepts them. Do not add a second caller of this method, or any other
   * way to spend this account, without revisiting that decision explicitly
   * — see `CUSTOMER_PREPAID_BALANCE`'s own schema docblock.
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
