import { Injectable } from '@nestjs/common';
import { Currency, LedgerAccountType, PspAttemptStatus, RefundRequestStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * What the platform actually has, what it is owed, and what it owes.
 *
 * ## Why this is not the Net Position
 *
 * A partner's Net Position is an accounting fact: what they are owed under
 * the contract, derived from postings. Liquidity is a different question with
 * a different answer — whether the money to pay them is *in the bank today*.
 * The two disagree routinely and legitimately: a partner can be owed 14,500
 * while the cash for it is still sitting with the provider, unremitted. A
 * settlement run off Net Position alone would authorise a transfer the bank
 * account cannot fund.
 *
 * So this read model keeps them apart on purpose, and `safeToPay` is the
 * conservative combination — what could be transferred today without relying
 * on money that has not arrived.
 *
 * ## What it deliberately does not do
 *
 * It does not move money, authorise anything, or trigger a payout. Arman's
 * decision stands: bank transfers are made by a human in a banking app. This
 * is the figure that human should be looking at first.
 */
@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService) {}

  async position(currency: Currency = Currency.AMD): Promise<LiquidityPosition> {
    const [accounts, pendingExposure, pendingRefunds, unknownFees] = await Promise.all([
      this.prisma.ledgerAccount.findMany({
        where: { currency },
        select: { type: true, balance: true, partnerId: true },
      }),
      this.pspExposure(currency),
      this.pendingRefundTotal(),
      this.unknownFeeCount(),
    ]);

    const sum = (type: LedgerAccountType) =>
      accounts
        .filter((a) => a.type === type)
        .reduce((total, a) => total.plus(a.balance), new Decimal(0));

    /*
     * Every balance in this ledger is debit-positive: `LedgerService` stores
     * a debit as `+amount` and a credit as `-amount`, whatever the account's
     * natural side. So the sign has to be read per account type rather than
     * assumed, and getting it backwards is easy — I did, and the chain test
     * below caught it.
     *
     * Cash and receivables are debit-normal, so a real balance reads
     * positive.
     */
    const bank = sum(LedgerAccountType.PLATFORM_BANK);
    const pspReceivable = sum(LedgerAccountType.PSP_RECEIVABLE);

    /*
     * `PARTNER_PAYABLE` is credit-normal, so a partner the platform *owes*
     * carries a negative balance and one who owes the platform carries a
     * positive one.
     *
     * Split rather than netted, which matters more than it looks: a partner
     * who owes 2,000 does not fund the 14,500 owed to a different partner.
     * Netting them would produce one tidy number that overstates what can be
     * paid out by exactly the debt.
     */
    const partnerAccounts = accounts.filter((a) => a.type === LedgerAccountType.PARTNER_PAYABLE);
    const partnerPayable = partnerAccounts
      .filter((a) => a.balance.lessThan(0))
      .reduce((total, a) => total.plus(a.balance.abs()), new Decimal(0));
    const partnerReceivable = partnerAccounts
      .filter((a) => a.balance.greaterThan(0))
      .reduce((total, a) => total.plus(a.balance), new Decimal(0));

    /*
     * The conservative figure, and every subtraction in it is deliberate.
     *
     * `pspReceivable` is **not** added: it is money the provider is holding
     * and has not remitted, and treating a claim as cash is how a platform
     * writes a cheque against money in transit.
     *
     * `pendingExposure` is subtracted because a payment that may have
     * succeeded may also be owed back to a partner the moment it resolves.
     * `pendingRefunds` likewise: a refund that has been requested is money
     * already committed elsewhere.
     */
    const safeToPay = bank.minus(pendingExposure).minus(pendingRefunds);

    return {
      currency,
      /** Cash the platform actually holds, per its own ledger. */
      platformBank: bank.toFixed(4),
      /** Captured through the provider and not yet remitted to the bank. */
      pspReceivable: pspReceivable.toFixed(4),
      /**
       * The same figure, named for what it means operationally: until an
       * acquirer settlement is recorded against it, this is money the
       * platform cannot spend.
       */
      unsettledAcquirerAmount: pspReceivable.toFixed(4),
      /** What partners are owed, summed across those in credit. */
      partnerPayable: partnerPayable.toFixed(4),
      /** What partners owe the platform, summed across those in debit. */
      partnerReceivable: partnerReceivable.toFixed(4),
      /**
       * Payments that might have succeeded and might not. Counted against
       * liquidity because the expensive resolution is the one where they
       * did: that money becomes a partner's the moment it is confirmed.
       */
      pendingPspExposure: pendingExposure.toFixed(4),
      pendingRefunds: pendingRefunds.toFixed(4),
      safeToPay: safeToPay.toFixed(4),
      /**
       * Provider fees the platform does not know.
       *
       * Not zero — **unknown**. Idram's documentation does not establish a
       * fee statement, so a captured payment carries `providerFeeAmount =
       * null`, and the honest read model says how many rather than quietly
       * treating the cost as nil. A platform that books unknown fees as zero
       * overstates what it can pay out by exactly the fees.
       */
      paymentsWithUnknownFee: unknownFees,
    };
  }

  /** Money the provider may be holding against purchases not yet resolved. */
  private async pspExposure(currency: Currency): Promise<Decimal> {
    const unresolved = await this.prisma.pspPaymentAttempt.findMany({
      where: {
        currency,
        status: {
          in: [
            PspAttemptStatus.INITIATED,
            PspAttemptStatus.PENDING_CONFIRMATION,
            PspAttemptStatus.EXPIRED,
            PspAttemptStatus.REQUIRES_RECONCILIATION,
          ],
        },
      },
      select: { amount: true },
    });
    return unresolved.reduce((total, a) => total.plus(a.amount), new Decimal(0));
  }

  /**
   * Refunds asked for and not yet settled.
   *
   * Reads the request queue rather than the ledger: a refund that has been
   * approved but not posted is money already committed, and liquidity is
   * about commitments, not about postings.
   */
  private async pendingRefundTotal(): Promise<Decimal> {
    const pending = await this.prisma.purchaseIntentRefundRequest.findMany({
      where: { status: RefundRequestStatus.PENDING },
      select: { amount: true, purchaseIntent: { select: { grossAmount: true } } },
    });
    // A request with no amount means "refund whatever remains", so the worst
    // case is the whole purchase. Counted at the worst case on purpose:
    // understating a commitment is how a payout is authorised against money
    // that is about to leave.
    return pending.reduce(
      (total, r) => total.plus(r.amount ?? r.purchaseIntent.grossAmount),
      new Decimal(0),
    );
  }

  private async unknownFeeCount(): Promise<number> {
    return this.prisma.pspPaymentAttempt.count({
      where: { status: PspAttemptStatus.SUCCEEDED, providerFeeAmount: null },
    });
  }
}

export interface LiquidityPosition {
  currency: Currency;
  platformBank: string;
  pspReceivable: string;
  unsettledAcquirerAmount: string;
  partnerPayable: string;
  partnerReceivable: string;
  pendingPspExposure: string;
  pendingRefunds: string;
  safeToPay: string;
  paymentsWithUnknownFee: number;
}
