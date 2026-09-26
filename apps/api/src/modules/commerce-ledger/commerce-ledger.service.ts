import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerAccountType, PostingDirection, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../ledger/ledger.service';

type Tx = Prisma.TransactionClient;

/** Where a posting points back to — the domain row that caused it. */
export interface CommerceLedgerSource {
  sourceType: string;
  sourceId: string;
}

/** A customer's TuTak money balance could not cover a capture in full. */
export class InsufficientTutakMoneyError extends BadRequestException {
  constructor() {
    super('Not enough money on your TuTak balance');
  }
}

/**
 * Every ledger movement Partner Commerce makes, in one place — the escrow
 * (`PARTNER_ORDER_ESCROW`) in and out, the dispute hold, and the post-
 * completion refunds. Each method is exactly one balanced
 * `LedgerService.post`, run inside the caller's transaction, and returns the
 * new `LedgerTransaction` id so the leg/intent/return that caused it can
 * reference it (spec §52: every amount traceable to its origin).
 *
 * Deliberately two ledger-level sources, never mixed (Arman, Q1 = C):
 *  - money:    CUSTOMER_PREPAID_BALANCE (the customer's real money);
 *  - discount: BONUS_LIABILITY (the green discount balance — the points
 *              themselves move in `BonusEngineService`; this is only the
 *              platform-side liability that funds the partner for them,
 *              exactly what `partner.bonus_redemption_compensation` has
 *              always been for a QR purchase).
 *
 * `accountFor` is called without `tx`, the same as
 * `CommissionDistributionService` and `PurchaseIntentsService`: every
 * caller here runs READ COMMITTED, and mixing a tx-bound and a tx-less
 * lookup of the same account inside one flow self-deadlocks (see
 * `CommissionDistributionService.postContribution`). Callers that run
 * Serializable pass `serializableTx` so the lookup joins their snapshot.
 */
@Injectable()
export class CommerceLedgerService {
  constructor(private readonly ledger: LedgerService) {}

  private account(
    spec: { type: LedgerAccountType; userId?: string; partnerId?: string },
    serializableTx?: Tx,
  ) {
    return this.ledger.accountFor(spec, serializableTx);
  }

  private async move(
    kind: string,
    source: CommerceLedgerSource,
    from: string,
    to: string,
    amount: Decimal,
    tx: Tx,
  ): Promise<string> {
    const posted = await this.ledger.post(
      {
        kind,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        postings: [
          { accountId: from, direction: PostingDirection.DEBIT, amount },
          { accountId: to, direction: PostingDirection.CREDIT, amount },
        ],
      },
      tx,
    );
    return posted.id;
  }

  /**
   * CUSTOMER_PREPAID_BALANCE → PARTNER_ORDER_ESCROW, only if the balance
   * covers the full amount. Claimed with a conditional `updateMany` on the
   * account row, the same idiom `CustomerBalanceService.collectFromBalance`
   * uses: two concurrent captures for the same customer serialise on the row
   * lock and the second re-evaluates `balance <= -amount` against the first's
   * committed result, so the balance can never be spent twice. The account
   * is credit-normal (negative when funded), hence `lte -amount`.
   */
  async captureMoney(userId: string, partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const balance = await this.account({ type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId });
    const claimed = await tx.ledgerAccount.updateMany({
      where: { id: balance.id, balance: { lte: amount.negated() } },
      data: { version: { increment: 1 } },
    });
    if (claimed.count === 0) throw new InsufficientTutakMoneyError();
    const escrow = await this.account({ type: LedgerAccountType.PARTNER_ORDER_ESCROW, partnerId });
    return this.move(kind, source, balance.id, escrow.id, amount, tx);
  }

  /** PARTNER_ORDER_ESCROW → CUSTOMER_PREPAID_BALANCE — a money leg returned before completion. */
  async returnMoney(userId: string, partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [escrow, balance] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_ORDER_ESCROW, partnerId }),
      this.account({ type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId }),
    ]);
    return this.move(kind, source, escrow.id, balance.id, amount, tx);
  }

  /** BONUS_LIABILITY → PARTNER_ORDER_ESCROW — the discount the customer spent, funded into escrow. */
  async captureDiscount(partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [liability, escrow] = await Promise.all([
      this.account({ type: LedgerAccountType.BONUS_LIABILITY }),
      this.account({ type: LedgerAccountType.PARTNER_ORDER_ESCROW, partnerId }),
    ]);
    return this.move(kind, source, liability.id, escrow.id, amount, tx);
  }

  /** PARTNER_ORDER_ESCROW → BONUS_LIABILITY — the discount handed back to the customer before completion. */
  async returnDiscount(partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [escrow, liability] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_ORDER_ESCROW, partnerId }),
      this.account({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);
    return this.move(kind, source, escrow.id, liability.id, amount, tx);
  }

  /** PARTNER_ORDER_ESCROW → PARTNER_PAYABLE — the electronic part becomes partner receivable. */
  async releaseToPartner(partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [escrow, payable] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_ORDER_ESCROW, partnerId }),
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
    ]);
    return this.move(kind, source, escrow.id, payable.id, amount, tx);
  }

  /** PARTNER_PAYABLE → CUSTOMER_PREPAID_BALANCE — money returned after completion (a return/refund). */
  async refundMoneyFromPartner(
    userId: string,
    partnerId: string,
    amount: Decimal,
    source: CommerceLedgerSource,
    kind: string,
    tx: Tx,
    serializableTx?: Tx,
  ) {
    const [payable, balance] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, serializableTx),
      this.account({ type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId }, serializableTx),
    ]);
    return this.move(kind, source, payable.id, balance.id, amount, tx);
  }

  /**
   * PARTNER_PAYABLE → BONUS_LIABILITY — the discount part of a return: the
   * partner hands back the compensation it received for the discount, the
   * points themselves are restored by `BonusEngineService.restoreSpentBonus`.
   */
  async refundDiscountFromPartner(
    partnerId: string,
    amount: Decimal,
    source: CommerceLedgerSource,
    kind: string,
    tx: Tx,
    serializableTx?: Tx,
  ) {
    const [payable, liability] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, serializableTx),
      this.account({ type: LedgerAccountType.BONUS_LIABILITY }, serializableTx),
    ]);
    return this.move(kind, source, payable.id, liability.id, amount, tx);
  }

  /** PARTNER_PAYABLE → PARTNER_DISPUTE_HOLD — frozen, out of reach of any payout (spec §49). */
  async holdForDispute(partnerId: string, amount: Decimal, source: CommerceLedgerSource, tx: Tx) {
    const [payable, hold] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
      this.account({ type: LedgerAccountType.PARTNER_DISPUTE_HOLD, partnerId }),
    ]);
    return this.move('order_dispute.hold', source, payable.id, hold.id, amount, tx);
  }

  /** PARTNER_DISPUTE_HOLD → PARTNER_PAYABLE — the freeze lifted by a resolution. */
  async releaseDisputeHold(partnerId: string, amount: Decimal, source: CommerceLedgerSource, tx: Tx) {
    const [hold, payable] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_DISPUTE_HOLD, partnerId }),
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }),
    ]);
    return this.move('order_dispute.release', source, hold.id, payable.id, amount, tx);
  }
}
