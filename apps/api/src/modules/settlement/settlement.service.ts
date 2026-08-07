import { Injectable, Logger } from '@nestjs/common';
import {
  BonusEntryType,
  Currency,
  LedgerAccountType,
  PaymentStatus,
  PostingDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { MONEY_SCALE } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PhoneVerificationService } from '../auth/phone-verification.service';
import { LedgerService } from '../ledger/ledger.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { WalletService } from '../wallet/wallet.service';

/** UTC midnight of the day a timestamp falls in. Settlement batches by day. */
function dayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function dayEnd(start: Date): Date {
  return new Date(start.getTime() + 24 * 60 * 60_000);
}

export interface SettlementResult {
  settlementId: string;
  /** False when the payment was already settled — a redelivered event, not an error. */
  claimed: boolean;
  bonusAccrued: string;
}

/**
 * Phase 4 of the financial core: the point at which a captured payment
 * becomes final.
 *
 * Settlement moves no money between the platform and the partner — capture
 * already posted DR PSP_RECEIVABLE / CR PARTNER_PAYABLE / CR PLATFORM_REVENUE.
 * What settlement adds is bonus accrual, and *when* it happens is the whole
 * point: points earned on a payment that is later charged back must never
 * have been issued, rather than issued and clawed back from a customer who
 * may already have spent them.
 *
 * Driven by the outbox rather than a cron sweep, so a payment settles as
 * soon as its event is delivered and the durability guarantee is the outbox's
 * (docs/AUDIT_FINAL_2026-08.md H-2) rather than a second, weaker one here.
 * Delivery is at-least-once, so every step below is idempotent.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly bonusEngine: BonusEngineService,
    private readonly wallet: WalletService,
    private readonly phoneVerification: PhoneVerificationService,
  ) {}

  /**
   * Settles one captured payment.
   *
   * Safe to call repeatedly with the same payment: the claim is a conditional
   * UPDATE on `settlementId IS NULL`, so a redelivered event finds the
   * payment already claimed and returns without accruing a second time.
   */
  async settlePayment(paymentId: string): Promise<SettlementResult> {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { partner: true },
    });

    if (payment.status !== PaymentStatus.CAPTURED) {
      // A declined payment moved no money and has nothing to settle. Not an
      // error — just nothing to do — so it must not be retried forever.
      return { settlementId: '', claimed: false, bonusAccrued: '0' };
    }

    const periodStart = dayStart(payment.createdAt);
    const settlement = await this.findOrCreateSettlement(payment.partnerId, periodStart);

    // Only the portion that survived to settlement earns anything. A payment
    // refunded before its settlement event was delivered accrues on what is
    // left, or on nothing at all if it was refunded in full.
    const settleableAmount = payment.amount.minus(payment.refundedAmount);
    const bonusEarned = await this.bonusFor(payment.userId, settleableAmount, payment.partner);

    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, settlementId: null },
      data: { settlementId: settlement.id, settledAt: new Date() },
    });

    if (claimed.count === 0) {
      // Already settled by an earlier delivery of the same event, or by a
      // concurrent worker. Either way the accrual below has already happened.
      return {
        settlementId: settlement.id,
        claimed: false,
        bonusAccrued: '0',
      };
    }

    await this.prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        grossAmount: { increment: settleableAmount },
        commissionAmount: { increment: payment.commissionAmount },
        netAmount: { increment: settleableAmount.minus(payment.commissionAmount) },
        bonusAccrued: { increment: bonusEarned },
        paymentCount: { increment: 1 },
      },
    });

    if (bonusEarned.greaterThan(0)) {
      await this.accrueAndPostLiability(payment.userId, payment.id, bonusEarned, payment.currency);
    }

    this.logger.log(
      `Settled payment ${payment.id} into ${settlement.id}, accrued ${bonusEarned.toString()}`,
    );

    return {
      settlementId: settlement.id,
      claimed: true,
      bonusAccrued: bonusEarned.toFixed(MONEY_SCALE),
    };
  }

  /**
   * How much bonus this payment earns.
   *
   * Returns zero rather than throwing when the customer cannot earn: an
   * unverified phone is a legitimate business state, not a delivery failure,
   * and throwing here would put the outbox into a retry loop that ends in
   * dead-lettering a payment that settled perfectly well. The money still
   * settles and the partner is still paid — only the points are withheld.
   */
  private async bonusFor(
    userId: string,
    settleableAmount: Decimal,
    partner: { bonusAccrualRateBps: number },
  ): Promise<Decimal> {
    if (settleableAmount.lessThanOrEqualTo(0)) return new Decimal(0);

    const canEarn = await this.phoneVerification
      .assertCanEarn(userId)
      .then(() => true)
      .catch(() => false);
    if (!canEarn) return new Decimal(0);

    return settleableAmount
      .times(partner.bonusAccrualRateBps)
      .dividedBy(10_000)
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN);
  }

  /**
   * Issues the points and records what they cost.
   *
   * Points are a liability the moment they are issued: the platform owes the
   * customer that value at redemption. Recording only the bonus-ledger side
   * would leave the double-entry ledger claiming the platform kept revenue it
   * has already committed to giving back.
   */
  private async accrueAndPostLiability(
    userId: string,
    paymentId: string,
    amount: Decimal,
    currency: Currency,
  ): Promise<void> {
    const walletId = await this.wallet.getWalletIdForUser(userId);

    const [revenueAccount, liabilityAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE, currency }),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY, currency }),
    ]);

    await this.prisma.$transaction(async (tx) => {
      const lot = await this.bonusEngine.accrue(
        {
          walletId,
          type: BonusEntryType.ACCRUAL_PURCHASE,
          amount,
          metadata: { settledPaymentId: paymentId },
        },
        tx,
      );

      await this.ledger.post(
        {
          kind: 'settlement.bonus_accrued',
          sourceType: 'Payment',
          sourceId: paymentId,
          currency,
          postings: [
            { accountId: revenueAccount.id, direction: PostingDirection.DEBIT, amount },
            { accountId: liabilityAccount.id, direction: PostingDirection.CREDIT, amount },
          ],
        },
        tx,
      );

      // Written in the same transaction as the lot it points at, so a refund
      // can never find a payment claiming points that were not issued.
      await tx.payment.update({
        where: { id: paymentId },
        data: { accruedLotId: lot.id },
      });
    });
  }

  /**
   * One settlement per partner per day.
   *
   * Racing creators collide on `@@unique([partnerId, periodStart])` rather
   * than on a read-then-write check, so the loser re-reads the winner's row
   * instead of creating a duplicate day.
   */
  private async findOrCreateSettlement(partnerId: string, periodStart: Date) {
    const existing = await this.prisma.settlement.findUnique({
      where: { partnerId_periodStart: { partnerId, periodStart } },
    });
    if (existing) return existing;

    try {
      return await this.prisma.settlement.create({
        data: { partnerId, periodStart, periodEnd: dayEnd(periodStart) },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.settlement.findUniqueOrThrow({
          where: { partnerId_periodStart: { partnerId, periodStart } },
        });
      }
      throw err;
    }
  }

  /** A partner's settlement history, newest first. */
  listForPartner(partnerId: string, limit = 30) {
    return this.prisma.settlement.findMany({
      where: { partnerId },
      orderBy: { periodStart: 'desc' },
      take: limit,
    });
  }
}
