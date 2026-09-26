import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  PartnerOrderPaymentLeg,
  PaymentLegPurpose,
  PaymentLegStatus,
  PaymentLegType,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CommerceLedgerService } from '../commerce-ledger/commerce-ledger.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { WalletService } from '../wallet/wallet.service';

type Tx = Prisma.TransactionClient;

const ZERO = new Decimal(0);

/** How a slice of the order total is to be paid. discount + tutakMoney + external = the slice. */
export interface PaymentSplit {
  discount: Decimal;
  tutakMoney: Decimal;
  external: Decimal;
}

/** Ledger kinds, one per movement, so every posting reads for itself. */
export const LEG_KINDS = {
  discountCapture: 'partner_order.discount_capture',
  moneyCapture: 'partner_order.money_capture',
  discountReturn: 'partner_order.discount_return',
  moneyReturn: 'partner_order.money_return',
  completion: 'partner_order.completion',
} as const;

/**
 * The payment legs of one `PartnerOrder` — spec §23/§47's provenance of
 * every unit of money, and Q2's real escrow. Every method here runs inside
 * the caller's transaction, after the caller's own conditional status claim,
 * so each financial effect happens at most once per claim.
 *
 * The discount (green) balance is spent through the existing bonus engine
 * (reserve → settle, exactly like a QR purchase) and its platform-side value
 * moves BONUS_LIABILITY → escrow; TuTak money moves CUSTOMER_PREPAID_BALANCE
 * → escrow. Two separate legs, two separate postings — never one netted
 * figure (Q1: "Не смешивать скидочный balance и денежный balance в Ledger").
 * External legs never touch the ledger at all: TuTak never received that
 * money (spec §47).
 */
@Injectable()
export class PartnerOrderPaymentsService {
  private readonly logger = new Logger(PartnerOrderPaymentsService.name);

  constructor(
    private readonly commerceLedger: CommerceLedgerService,
    private readonly bonusEngine: BonusEngineService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * The bonus reservation has to exist before the caller's transaction:
   * `BonusEngineService.reserve` runs its own Serializable transaction (lot
   * allocation). It is settled inside the caller's transaction by
   * `captureLegs`; if that transaction fails, the caller compensates it with
   * `compensateDiscount` — the same shape `PurchaseIntentsService.create`
   * already uses.
   */
  async reserveDiscount(customerId: string, amount: Decimal, sourceTransactionId: string): Promise<string | null> {
    if (!amount.greaterThan(0)) return null;
    const walletId = await this.walletService.getWalletIdForUser(customerId);
    const reservation = await this.bonusEngine.reserve(walletId, amount, sourceTransactionId, 600);
    return reservation.reservationId;
  }

  async compensateDiscount(reservationId: string | null, reason: string): Promise<void> {
    if (!reservationId) return;
    await this.bonusEngine
      .compensateReservation(reservationId, reason)
      .catch((e) => this.logger.error(`Failed to release discount reservation ${reservationId}: ${e}`));
  }

  /**
   * Creates the legs for one slice (the original order, or a price
   * increase's additional amount) and captures every electronic one into
   * escrow. Throws `InsufficientTutakMoneyError` if the money balance cannot
   * cover its leg — the caller's transaction then rolls back whole.
   */
  async captureLegs(
    tx: Tx,
    order: { id: string; partnerId: string },
    customerId: string,
    split: PaymentSplit,
    ctx: { purpose: PaymentLegPurpose; adjustmentId?: string; discountReservationId: string | null; source: { sourceType: string; sourceId: string } },
  ): Promise<void> {
    const now = new Date();

    if (split.discount.greaterThan(0)) {
      if (!ctx.discountReservationId) throw new Error('A discount leg needs its bonus reservation');
      await this.bonusEngine.settleReservation(ctx.discountReservationId, tx);
      const captureId = await this.commerceLedger.captureDiscount(
        order.partnerId,
        split.discount,
        ctx.source,
        LEG_KINDS.discountCapture,
        tx,
      );
      await tx.partnerOrderPaymentLeg.create({
        data: {
          orderId: order.id,
          type: PaymentLegType.DISCOUNT,
          purpose: ctx.purpose,
          adjustmentId: ctx.adjustmentId,
          status: PaymentLegStatus.CAPTURED,
          amount: split.discount,
          bonusReservationId: ctx.discountReservationId,
          captureLedgerTransactionId: captureId,
          capturedAt: now,
        },
      });
    }

    if (split.tutakMoney.greaterThan(0)) {
      const captureId = await this.commerceLedger.captureMoney(
        customerId,
        order.partnerId,
        split.tutakMoney,
        ctx.source,
        LEG_KINDS.moneyCapture,
        tx,
      );
      await tx.partnerOrderPaymentLeg.create({
        data: {
          orderId: order.id,
          type: PaymentLegType.TUTAK_MONEY,
          purpose: ctx.purpose,
          adjustmentId: ctx.adjustmentId,
          status: PaymentLegStatus.CAPTURED,
          amount: split.tutakMoney,
          captureLedgerTransactionId: captureId,
          capturedAt: now,
        },
      });
    }

    if (split.external.greaterThan(0)) {
      await tx.partnerOrderPaymentLeg.create({
        data: {
          orderId: order.id,
          type: PaymentLegType.EXTERNAL,
          purpose: ctx.purpose,
          adjustmentId: ctx.adjustmentId,
          status: PaymentLegStatus.PENDING,
          amount: split.external,
        },
      });
    }
  }

  /**
   * Cancel before completion (spec §43, F4): every electronic leg goes back
   * to its own source in full — no penalty of any kind — and a confirmed
   * external leg becomes RETURN_PENDING (the partner holds that cash and
   * confirms handing it back). Returns whether anything is still pending on
   * the partner's side.
   */
  async returnAllLegs(tx: Tx, order: { id: string; partnerId: string; customerId: string | null }, reason: string) {
    const legs = await tx.partnerOrderPaymentLeg.findMany({ where: { orderId: order.id } });
    const now = new Date();
    const source = { sourceType: 'PartnerOrder', sourceId: order.id };
    let externalPending = false;

    for (const leg of legs) {
      const outstanding = leg.amount.minus(leg.refundedAmount);
      if (leg.status === PaymentLegStatus.CAPTURED && leg.type === PaymentLegType.DISCOUNT) {
        // A leg never partially reduced goes back into the very lots it came
        // from (original expiry kept); a partially reduced one returns its
        // remainder as a fresh lot, like any partial refund.
        if (leg.refundedAmount.isZero()) {
          await this.bonusEngine.reverseSettlement(leg.bonusReservationId!, reason, tx);
        } else if (outstanding.greaterThan(0)) {
          await this.restoreDiscount(tx, order.customerId!, outstanding, leg, reason);
        }
        const returnId = outstanding.greaterThan(0)
          ? await this.commerceLedger.returnDiscount(order.partnerId, outstanding, source, LEG_KINDS.discountReturn, tx)
          : null;
        await this.markReturned(tx, leg, returnId, now);
      } else if (leg.status === PaymentLegStatus.CAPTURED && leg.type === PaymentLegType.TUTAK_MONEY) {
        const returnId = outstanding.greaterThan(0)
          ? await this.commerceLedger.returnMoney(order.customerId!, order.partnerId, outstanding, source, LEG_KINDS.moneyReturn, tx)
          : null;
        await this.markReturned(tx, leg, returnId, now);
      } else if (leg.type === PaymentLegType.EXTERNAL && leg.status === PaymentLegStatus.PENDING) {
        await this.markReturned(tx, leg, null, now);
      } else if (leg.type === PaymentLegType.EXTERNAL && leg.status === PaymentLegStatus.CONFIRMED) {
        const claimed = await tx.partnerOrderPaymentLeg.updateMany({
          where: { id: leg.id, status: PaymentLegStatus.CONFIRMED },
          data: { status: PaymentLegStatus.RETURN_PENDING },
        });
        if (claimed.count === 1) externalPending = true;
      } else if (leg.status === PaymentLegStatus.RETURN_PENDING) {
        externalPending = true;
      }
    }
    return { externalPending };
  }

  private async markReturned(tx: Tx, leg: PartnerOrderPaymentLeg, returnLedgerTransactionId: string | null, now: Date) {
    const claimed = await tx.partnerOrderPaymentLeg.updateMany({
      where: { id: leg.id, status: leg.status },
      data: { status: PaymentLegStatus.RETURNED, returnLedgerTransactionId, returnedAt: now },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This payment was changed concurrently — please retry');
    }
  }

  private async restoreDiscount(tx: Tx, customerId: string, amount: Decimal, leg: PartnerOrderPaymentLeg, reason: string) {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: customerId } });
    const reservation = await tx.bonusReservation.findUniqueOrThrow({ where: { id: leg.bonusReservationId! } });
    await this.bonusEngine.restoreSpentBonus(wallet.id, amount, reservation.reasonTransactionId ?? leg.orderId, reason, tx);
  }

  /**
   * A price decrease accepted by the customer (spec §41): the difference
   * comes off the legs, cheapest-to-undo first — an unpaid external leg
   * simply shrinks, then TuTak money goes back to the balance, then the
   * discount is restored. A difference that could only come out of cash the
   * partner already confirmed receiving is refused here (the caller routes
   * it to manual review) rather than invented as a new cash-refund flow.
   * Returns how much came off each source.
   */
  async reduceLegs(
    tx: Tx,
    order: { id: string; partnerId: string; customerId: string },
    delta: Decimal,
    source: { sourceType: string; sourceId: string },
    reason: string,
  ): Promise<PaymentSplit> {
    const legs = await tx.partnerOrderPaymentLeg.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    const byPriority = [
      ...legs.filter((l) => l.type === PaymentLegType.EXTERNAL && l.status === PaymentLegStatus.PENDING),
      ...legs.filter((l) => l.type === PaymentLegType.TUTAK_MONEY && l.status === PaymentLegStatus.CAPTURED),
      ...legs.filter((l) => l.type === PaymentLegType.DISCOUNT && l.status === PaymentLegStatus.CAPTURED),
    ];
    const reduced: PaymentSplit = { discount: ZERO, tutakMoney: ZERO, external: ZERO };
    let remaining = delta;

    for (const leg of byPriority) {
      if (!remaining.greaterThan(0)) break;
      const available = leg.amount.minus(leg.refundedAmount);
      const take = Decimal.min(available, remaining);
      if (!take.greaterThan(0)) continue;

      if (leg.type === PaymentLegType.EXTERNAL) {
        // Nothing was paid yet — the amount to collect is simply smaller.
        await this.shrinkLeg(tx, leg, take);
        reduced.external = reduced.external.plus(take);
      } else if (leg.type === PaymentLegType.TUTAK_MONEY) {
        await this.commerceLedger.returnMoney(order.customerId, order.partnerId, take, source, LEG_KINDS.moneyReturn, tx);
        await this.addRefunded(tx, leg, take);
        reduced.tutakMoney = reduced.tutakMoney.plus(take);
      } else {
        await this.restoreDiscount(tx, order.customerId, take, leg, reason);
        await this.commerceLedger.returnDiscount(order.partnerId, take, source, LEG_KINDS.discountReturn, tx);
        await this.addRefunded(tx, leg, take);
        reduced.discount = reduced.discount.plus(take);
      }
      remaining = remaining.minus(take);
    }

    if (remaining.greaterThan(0)) {
      throw new BadRequestException({
        message: 'The price difference can only be returned from cash the partner already received',
        code: 'PRICE_DECREASE_NEEDS_EXTERNAL_REFUND',
      });
    }
    return reduced;
  }

  /**
   * An unpaid external leg owes less. Tracked through `refundedAmount` like
   * every other reduction (a leg's live amount is always
   * `amount - refundedAmount`), so the leg keeps its original figure for
   * the record; a leg reduced to nothing is closed as RETURNED.
   */
  private async shrinkLeg(tx: Tx, leg: PartnerOrderPaymentLeg, by: Decimal) {
    const after = leg.refundedAmount.plus(by);
    const claimed = await tx.partnerOrderPaymentLeg.updateMany({
      where: { id: leg.id, status: PaymentLegStatus.PENDING, refundedAmount: leg.refundedAmount },
      data: {
        refundedAmount: after,
        ...(after.equals(leg.amount) ? { status: PaymentLegStatus.RETURNED, returnedAt: new Date() } : {}),
      },
    });
    if (claimed.count === 0) throw new BadRequestException('This payment was changed concurrently — please retry');
  }

  private async addRefunded(tx: Tx, leg: PartnerOrderPaymentLeg, by: Decimal) {
    const claimed = await tx.partnerOrderPaymentLeg.updateMany({
      where: { id: leg.id, refundedAmount: leg.refundedAmount },
      data: { refundedAmount: leg.refundedAmount.plus(by) },
    });
    if (claimed.count === 0) throw new BadRequestException('This payment was changed concurrently — please retry');
  }

  /**
   * Completion (F3): every captured electronic leg's outstanding amount
   * leaves escrow for PARTNER_PAYABLE in one posting. Only called once, by
   * the caller that won the RECEIVED → COMPLETED claim.
   */
  async releaseForCompletion(tx: Tx, order: { id: string; partnerId: string }): Promise<{ released: Decimal; ledgerTransactionId: string | null }> {
    const legs = await tx.partnerOrderPaymentLeg.findMany({
      where: { orderId: order.id, status: PaymentLegStatus.CAPTURED },
    });
    const released = legs.reduce((sum, l) => sum.plus(l.amount.minus(l.refundedAmount)), ZERO);
    const ledgerTransactionId = released.greaterThan(0)
      ? await this.commerceLedger.releaseToPartner(
          order.partnerId,
          released,
          { sourceType: 'PartnerOrder', sourceId: order.id },
          LEG_KINDS.completion,
          tx,
        )
      : null;
    const now = new Date();
    for (const leg of legs) {
      await tx.partnerOrderPaymentLeg.updateMany({
        where: { id: leg.id, status: PaymentLegStatus.CAPTURED },
        data: { status: PaymentLegStatus.SETTLED, settledAt: now },
      });
    }
    return { released, ledgerTransactionId };
  }
}
