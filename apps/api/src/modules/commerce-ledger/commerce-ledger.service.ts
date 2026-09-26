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
 * Every ledger movement Partner Commerce makes, in one place — the two
 * escrows in and out, the dispute hold, the post-completion refunds and the
 * Q9 shortfall clearing. Each method is exactly one balanced
 * `LedgerService.post`, run inside the caller's transaction, and returns the
 * new `LedgerTransaction` id so the leg/intent/return that caused it can
 * reference it (spec §52: every amount traceable to its origin).
 *
 * Deliberately two ledger-level sources, never mixed (Arman, Q1 = C), each
 * with its own escrow account (item 9 of the final fixes):
 *  - money:    CUSTOMER_PREPAID_BALANCE ⇄ PARTNER_ORDER_MONEY_ESCROW (the
 *              customer's real money);
 *  - discount: BONUS_LIABILITY ⇄ PARTNER_ORDER_DISCOUNT_ESCROW (the green
 *              discount balance — the points themselves move in
 *              `BonusEngineService`; this is only the platform-side
 *              liability that funds the partner for them, exactly what
 *              `partner.bonus_redemption_compensation` has always been for a
 *              QR purchase).
 * The only way out of either escrow is back to its own source or on to
 * PARTNER_PAYABLE; there is no method that could move discount value into
 * CUSTOMER_PREPAID_BALANCE or money into BONUS_LIABILITY, and the
 * provenance invariant test checks every posting on both escrows.
 *
 * Every `accountFor` joins the caller's transaction (`serializableTx` when
 * the caller passes one, `tx` otherwise), uniformly — the same discipline
 * `CommissionDistributionService` and `PurchaseIntentsService` follow. A
 * tx-less lookup inside a flow that created the same account in its own
 * still-open transaction blocks on that uncommitted row until the 5s
 * interactive-transaction timeout (the QR confirmation's money release
 * after the contribution posting created `PARTNER_PAYABLE` did exactly
 * that), and it borrows a second pool connection besides.
 */
@Injectable()
export class CommerceLedgerService {
  constructor(private readonly ledger: LedgerService) {}

  private account(spec: { type: LedgerAccountType; userId?: string; partnerId?: string }, tx: Tx) {
    return this.ledger.accountFor(spec, tx);
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
   * CUSTOMER_PREPAID_BALANCE → PARTNER_ORDER_MONEY_ESCROW, only if the balance
   * covers the full amount. Claimed with a conditional `updateMany` on the
   * account row, the same idiom `CustomerBalanceService.collectFromBalance`
   * uses: two concurrent captures for the same customer serialise on the row
   * lock and the second re-evaluates `balance <= -amount` against the first's
   * committed result, so the balance can never be spent twice. The account
   * is credit-normal (negative when funded), hence `lte -amount`.
   */
  async captureMoney(userId: string, partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const balance = await this.account({ type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId }, tx);
    const claimed = await tx.ledgerAccount.updateMany({
      where: { id: balance.id, balance: { lte: amount.negated() } },
      data: { version: { increment: 1 } },
    });
    if (claimed.count === 0) throw new InsufficientTutakMoneyError();
    const escrow = await this.account({ type: LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW, partnerId }, tx);
    return this.move(kind, source, balance.id, escrow.id, amount, tx);
  }

  /** PARTNER_ORDER_MONEY_ESCROW → CUSTOMER_PREPAID_BALANCE — a money leg returned before completion. */
  async returnMoney(userId: string, partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [escrow, balance] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW, partnerId }, tx),
      this.account({ type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId }, tx),
    ]);
    return this.move(kind, source, escrow.id, balance.id, amount, tx);
  }

  /** BONUS_LIABILITY → PARTNER_ORDER_DISCOUNT_ESCROW — the discount the customer spent, funded into escrow. */
  async captureDiscount(partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [liability, escrow] = await Promise.all([
      this.account({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.account({ type: LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW, partnerId }, tx),
    ]);
    return this.move(kind, source, liability.id, escrow.id, amount, tx);
  }

  /** PARTNER_ORDER_DISCOUNT_ESCROW → BONUS_LIABILITY — the discount handed back to the customer before completion. */
  async returnDiscount(partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [escrow, liability] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW, partnerId }, tx),
      this.account({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
    ]);
    return this.move(kind, source, escrow.id, liability.id, amount, tx);
  }

  /** PARTNER_ORDER_MONEY_ESCROW → PARTNER_PAYABLE — the money part becomes partner receivable (QR confirm, cancellation cost). */
  async releaseMoneyToPartner(partnerId: string, amount: Decimal, source: CommerceLedgerSource, kind: string, tx: Tx) {
    const [escrow, payable] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW, partnerId }, tx),
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, tx),
    ]);
    return this.move(kind, source, escrow.id, payable.id, amount, tx);
  }

  /**
   * Completion of an online order: both escrows → PARTNER_PAYABLE in one
   * balanced transaction, each escrow debited for exactly its own legs.
   */
  async releaseOrderToPartner(
    partnerId: string,
    amounts: { money: Decimal; discount: Decimal },
    source: CommerceLedgerSource,
    kind: string,
    tx: Tx,
  ): Promise<string | null> {
    const total = amounts.money.plus(amounts.discount);
    if (!total.greaterThan(0)) return null;
    const [moneyEscrow, discountEscrow, payable] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_ORDER_MONEY_ESCROW, partnerId }, tx),
      this.account({ type: LedgerAccountType.PARTNER_ORDER_DISCOUNT_ESCROW, partnerId }, tx),
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, tx),
    ]);
    const posted = await this.ledger.post(
      {
        kind,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        postings: [
          ...(amounts.money.greaterThan(0) ? [{ accountId: moneyEscrow.id, direction: PostingDirection.DEBIT, amount: amounts.money }] : []),
          ...(amounts.discount.greaterThan(0)
            ? [{ accountId: discountEscrow.id, direction: PostingDirection.DEBIT, amount: amounts.discount }]
            : []),
          { accountId: payable.id, direction: PostingDirection.CREDIT, amount: total },
        ],
      },
      tx,
    );
    return posted.id;
  }

  /**
   * PARTNER_PAYABLE → CUSTOMER_PREPAID_BALANCE — money returned after
   * completion (a return/refund). Q9: `recovered` of the gross `amount` is
   * kept to cover the customer's own shortfall on the same return — the
   * posting shows the gross debit, the net credit to the customer and the
   * recovered credit to their CUSTOMER_SHORTFALL_CLEARING separately.
   */
  async refundMoneyFromPartner(
    userId: string,
    partnerId: string,
    amount: Decimal,
    source: CommerceLedgerSource,
    kind: string,
    tx: Tx,
    serializableTx?: Tx,
    recovered: Decimal = new Decimal(0),
  ) {
    const [payable, balance] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, serializableTx ?? tx),
      this.account({ type: LedgerAccountType.CUSTOMER_PREPAID_BALANCE, userId }, serializableTx ?? tx),
    ]);
    if (!recovered.greaterThan(0)) return this.move(kind, source, payable.id, balance.id, amount, tx);
    if (recovered.greaterThan(amount)) throw new Error('Recovered shortfall cannot exceed the money refund');
    const clearing = await this.account({ type: LedgerAccountType.CUSTOMER_SHORTFALL_CLEARING, userId }, serializableTx ?? tx);
    const net = amount.minus(recovered);
    const posted = await this.ledger.post(
      {
        kind,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        postings: [
          { accountId: payable.id, direction: PostingDirection.DEBIT, amount },
          ...(net.greaterThan(0) ? [{ accountId: balance.id, direction: PostingDirection.CREDIT, amount: net }] : []),
          { accountId: clearing.id, direction: PostingDirection.CREDIT, amount: recovered },
        ],
      },
      tx,
    );
    return posted.id;
  }

  /**
   * Q9: the part of a customer's shortfall settled in cash at the partner's
   * desk — kept from the external/cash refund and/or paid on top. The
   * partner now holds that cash for TuTak: DEBIT PARTNER_PAYABLE / CREDIT
   * the customer's CUSTOMER_SHORTFALL_CLEARING.
   */
  async recoverShortfallViaPartner(
    userId: string,
    partnerId: string,
    amount: Decimal,
    source: CommerceLedgerSource,
    kind: string,
    tx: Tx,
    serializableTx?: Tx,
  ) {
    const [payable, clearing] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, serializableTx ?? tx),
      this.account({ type: LedgerAccountType.CUSTOMER_SHORTFALL_CLEARING, userId }, serializableTx ?? tx),
    ]);
    return this.move(kind, source, payable.id, clearing.id, amount, tx);
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
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, serializableTx ?? tx),
      this.account({ type: LedgerAccountType.BONUS_LIABILITY }, serializableTx ?? tx),
    ]);
    return this.move(kind, source, payable.id, liability.id, amount, tx);
  }

  /** PARTNER_PAYABLE → PARTNER_DISPUTE_HOLD — frozen, out of reach of any payout (spec §49). */
  async holdForDispute(partnerId: string, amount: Decimal, source: CommerceLedgerSource, tx: Tx) {
    const [payable, hold] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, tx),
      this.account({ type: LedgerAccountType.PARTNER_DISPUTE_HOLD, partnerId }, tx),
    ]);
    return this.move('order_dispute.hold', source, payable.id, hold.id, amount, tx);
  }

  /** PARTNER_DISPUTE_HOLD → PARTNER_PAYABLE — the freeze lifted by a resolution. */
  async releaseDisputeHold(partnerId: string, amount: Decimal, source: CommerceLedgerSource, tx: Tx) {
    const [hold, payable] = await Promise.all([
      this.account({ type: LedgerAccountType.PARTNER_DISPUTE_HOLD, partnerId }, tx),
      this.account({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, tx),
    ]);
    return this.move('order_dispute.release', source, hold.id, payable.id, amount, tx);
  }
}
