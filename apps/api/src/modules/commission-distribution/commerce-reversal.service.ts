import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  AuditAction,
  BonusEntryType,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  ReferrerType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { roundIssued } from '../../common/utils/money';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';

type Tx = Prisma.TransactionClient;
const ZERO = new Decimal(0);

/**
 * The distribution snapshot a COMMERCE_V2 purchase carries — identical
 * columns on `PurchaseIntent` and `PartnerOrder` (see
 * `CommissionDistributionService.snapshotOf`).
 */
export interface ReversalSnapshot {
  /** The commission base the snapshot was computed on (order total / QR gross). */
  base: Decimal;
  poolAmount: Decimal | null;
  greenAmount: Decimal | null;
  deferredAmount: Decimal | null;
  referrer1Type: ReferrerType | null;
  referrer1UserId: string | null;
  referrer1PartnerId: string | null;
  referrer1Amount: Decimal | null;
  referrer2Type: ReferrerType | null;
  referrer2UserId: string | null;
  referrer2PartnerId: string | null;
  referrer2Amount: Decimal | null;
  referrer3Type: ReferrerType | null;
  referrer3UserId: string | null;
  referrer3PartnerId: string | null;
  referrer3Amount: Decimal | null;
  tutakAmount: Decimal | null;
  sourceTransactionId: string;
  customerId: string;
  /** The selling partner whose PARTNER_PAYABLE funded the pool. */
  partnerId: string;
}

export interface ReversalResult {
  poolΔ: Decimal;
  /** Q9: the customer's own allocation of this purchase they already spent. */
  customerShortfall: Decimal;
  /** Q8: spent USER-referral shares turned into withholdings. */
  referralWithheld: Decimal;
  /** Expired (never spent) bonus written back against BONUS_LIABILITY. */
  expiredWrittenBack: Decimal;
  /** Expired/forfeited deferred value reversed from PLATFORM_REVENUE. */
  revenueReversed: Decimal;
  contributionLedgerTransactionId: string | null;
}

/**
 * COMMERCE_V2 reversal of a purchase's 20/30/30/20 distribution for one
 * return/refund slice (Arman, Q8/Q9, 2026-09-26) — shared by online
 * `PartnerOrderReturnsService` and offline `PurchaseIntentRefundService`,
 * so both follow exactly one economic rule. Proportional through the same
 * cumulative watermarks as before (repeated partial returns never
 * over-reverse; a full return reverses exactly the original).
 *
 * Every slice of the allocation lands somewhere real — nothing is
 * absorbed by TuTak, nothing becomes a negative balance:
 *  - unspent value: clawed back from the lot (BONUS_LIABILITY);
 *  - expired value: lot expiry never released the double-entry liability,
 *    so it is written back against BONUS_LIABILITY (not charged to anyone);
 *    an expired or forfeited *deferred* lot already went to
 *    PLATFORM_REVENUE, so it is reversed from there;
 *  - a USER referrer's spent share → `ReferralWithholding` (Q8): repaid by
 *    their future accruals; the selling partner's commission refund for it
 *    is credited as it is repaid, not now ("the partner waits");
 *  - a PARTNER referrer's share → ordinary reversal of its PARTNER_PAYABLE;
 *  - the customer's own spent share → `customerShortfall`, debited to their
 *    CUSTOMER_SHORTFALL_CLEARING; the caller must recover exactly that much
 *    in the same transaction (Q9 netting / desk settlement).
 */
@Injectable()
export class CommerceReversalService {
  constructor(
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly referralService: ReferralService,
    private readonly ledger: LedgerService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Of `amount` a lot could not give back, how much had expired (and is not
   * yet written back by an earlier slice) versus how much was spent/
   * withheld. Expired first — the customer-/referrer-favourable order; a
   * full return attributes everything either way.
   */
  private async splitUnrecovered(tx: Tx, lotId: string, amount: Decimal): Promise<{ expired: Decimal; spent: Decimal }> {
    if (!amount.greaterThan(0)) return { expired: ZERO, spent: ZERO };
    const lot = await tx.bonusLot.findUniqueOrThrow({ where: { id: lotId } });
    const expiredTotal = await tx.bonusLedgerEntry.aggregate({
      where: { relatedLotId: lotId, type: BonusEntryType.EXPIRY },
      _sum: { amount: true },
    });
    const unattributed = Decimal.max((expiredTotal._sum.amount ?? ZERO).minus(lot.expiredWrittenBackAmount), ZERO);
    const expired = Decimal.min(amount, unattributed);
    if (expired.greaterThan(0)) {
      const claimed = await tx.bonusLot.updateMany({
        where: { id: lotId, expiredWrittenBackAmount: lot.expiredWrittenBackAmount },
        data: { expiredWrittenBackAmount: lot.expiredWrittenBackAmount.plus(expired) },
      });
      if (claimed.count === 0) throw new Error('Bonus lot changed concurrently — retry');
    }
    return { expired, spent: amount.minus(expired) };
  }

  async reverse(
    tx: Tx,
    snap: ReversalSnapshot,
    cumulativeBefore: Decimal,
    cumulativeAfter: Decimal,
    reason: string,
    source: { sourceType: string; sourceId: string },
    actorUserId: string | null,
  ): Promise<ReversalResult> {
    if (snap.poolAmount === null || snap.greenAmount === null || snap.deferredAmount === null || snap.tutakAmount === null) {
      throw new InternalServerErrorException('Distribution snapshot incomplete — manual reconciliation required');
    }
    const shareAt = (value: Decimal | null, cumulative: Decimal) =>
      !value || value.lessThanOrEqualTo(0) ? ZERO : roundIssued(value.times(cumulative).dividedBy(snap.base));
    const delta = (value: Decimal | null) => shareAt(value, cumulativeAfter).minus(shareAt(value, cumulativeBefore));

    const poolΔ = delta(snap.poolAmount);
    const greenΔ = delta(snap.greenAmount);
    const deferredΔ = delta(snap.deferredAmount);
    const levels = [
      { level: 1, type: snap.referrer1Type, userId: snap.referrer1UserId, partnerId: snap.referrer1PartnerId, amountΔ: delta(snap.referrer1Amount) },
      { level: 2, type: snap.referrer2Type, userId: snap.referrer2UserId, partnerId: snap.referrer2PartnerId, amountΔ: delta(snap.referrer2Amount) },
      { level: 3, type: snap.referrer3Type, userId: snap.referrer3UserId, partnerId: snap.referrer3PartnerId, amountΔ: delta(snap.referrer3Amount) },
    ];
    // TuTak's residual, never independently rounded — every leg sums to poolΔ.
    const tutakΔ = poolΔ.minus(greenΔ).minus(deferredΔ).minus(levels.reduce((s, l) => s.plus(l.amountΔ), ZERO));
    const sourceTransactionId = snap.sourceTransactionId;

    let liabilityΔ = ZERO; // DEBIT BONUS_LIABILITY: clawed + expired write-backs
    let expiredWrittenBack = ZERO;
    let revenueReversed = ZERO;
    let customerShortfall = ZERO;
    let referralWithheld = ZERO;

    // The customer's green accrual.
    if (greenΔ.greaterThan(0)) {
      const lot = await tx.bonusLot.findFirst({ where: { sourceTransactionId, type: BonusEntryType.ACCRUAL_PURCHASE } });
      if (!lot) throw new InternalServerErrorException(`Green lot of ${sourceTransactionId} missing — manual reconciliation required`);
      const clawed = (await this.bonusEngine.reverseAccrualLot(lot.id, reason, greenΔ, tx)) ?? ZERO;
      const { expired, spent } = await this.splitUnrecovered(tx, lot.id, greenΔ.minus(clawed));
      liabilityΔ = liabilityΔ.plus(clawed).plus(expired);
      expiredWrittenBack = expiredWrittenBack.plus(expired);
      customerShortfall = customerShortfall.plus(spent);
    }

    // Every USER referral level: available part now, spent part withheld (Q8).
    const withholdings: { level: number; userId: string; amount: Decimal; id: string }[] = [];
    for (const lvl of levels) {
      if (lvl.type !== ReferrerType.USER || !lvl.userId || !lvl.amountΔ.greaterThan(0)) continue;
      const wallet = await tx.wallet.findUnique({ where: { userId: lvl.userId } });
      const lot = wallet
        ? await tx.bonusLot.findFirst({ where: { sourceTransactionId, type: BonusEntryType.ACCRUAL_REFERRAL, walletId: wallet.id } })
        : null;
      if (!wallet || !lot) {
        throw new InternalServerErrorException(`Referral lot (L${lvl.level}) of ${sourceTransactionId} missing — manual reconciliation required`);
      }
      const clawed = (await this.bonusEngine.reverseAccrualLot(lot.id, reason, lvl.amountΔ, tx)) ?? ZERO;
      const { expired, spent } = await this.splitUnrecovered(tx, lot.id, lvl.amountΔ.minus(clawed));
      liabilityΔ = liabilityΔ.plus(clawed).plus(expired);
      expiredWrittenBack = expiredWrittenBack.plus(expired);
      if (spent.greaterThan(0)) {
        const withholding = await tx.referralWithholding.create({
          data: {
            userId: lvl.userId,
            walletId: wallet.id,
            level: lvl.level,
            amount: spent,
            remainingAmount: spent,
            beneficiaryPartnerId: snap.partnerId,
            sourceTransactionId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
          },
        });
        withholdings.push({ level: lvl.level, userId: lvl.userId, amount: spent, id: withholding.id });
        referralWithheld = referralWithheld.plus(spent);
      }
    }

    // This purchase's own deferred (black) lot.
    if (deferredΔ.greaterThan(0)) {
      const r = await this.deferredBonusLots.reverseForRefund(sourceTransactionId, deferredΔ, reason, tx);
      if (r.lotMissing) throw new InternalServerErrorException(`Deferred lot of ${sourceTransactionId} missing — manual reconciliation required`);
      liabilityΔ = liabilityΔ.plus(r.liabilityToReverse);
      revenueReversed = revenueReversed.plus(r.revenueRecognized);
      if (r.unrecoveredFromGrant.greaterThan(0)) {
        if (r.grantedBonusLotId) {
          const { expired, spent } = await this.splitUnrecovered(tx, r.grantedBonusLotId, r.unrecoveredFromGrant);
          liabilityΔ = liabilityΔ.plus(expired);
          expiredWrittenBack = expiredWrittenBack.plus(expired);
          customerShortfall = customerShortfall.plus(spent);
        } else {
          customerShortfall = customerShortfall.plus(r.unrecoveredFromGrant);
        }
      }
    }

    // Turnover this purchase contributed elsewhere — dollar for dollar.
    const rawΔ = cumulativeAfter.minus(cumulativeBefore);
    await this.deferredBonusLots.reverseExternalContributions(sourceTransactionId, rawΔ, reason, tx);
    await this.referralService.reverseChallengeContribution(sourceTransactionId, rawΔ, reason, tx);

    const contributionLedgerTransactionId = await this.postContributionReversal(tx, snap, source, {
      partnerCreditΔ: poolΔ.minus(referralWithheld),
      liabilityΔ,
      partnerLevels: levels.filter((l) => l.type === ReferrerType.PARTNER && l.partnerId && l.amountΔ.greaterThan(0)),
      revenueΔ: tutakΔ.plus(revenueReversed),
      customerShortfall,
    });

    for (const w of withholdings) {
      await this.auditService.record(
        {
          actorUserId: actorUserId ?? undefined,
          action: AuditAction.REFERRAL_WITHHOLDING_CREATED,
          entityType: 'ReferralWithholding',
          entityId: w.id,
          metadata: {
            referrerUserId: w.userId,
            level: w.level,
            amount: w.amount.toString(),
            beneficiaryPartnerId: snap.partnerId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sourceTransactionId,
          },
        },
        tx,
      );
    }

    return {
      poolΔ,
      customerShortfall,
      referralWithheld,
      expiredWrittenBack,
      revenueReversed,
      contributionLedgerTransactionId,
    };
  }

  /**
   * The mirror of `CommissionDistributionService.postContribution` for this
   * slice. The selling partner is credited its pool share *minus* whatever
   * is withheld from USER referrers (credited later, as repaid); the debit
   * side is every place the share really is. Accounts are looked up with
   * `tx` — every caller runs Serializable.
   */
  private async postContributionReversal(
    tx: Tx,
    snap: ReversalSnapshot,
    source: { sourceType: string; sourceId: string },
    amounts: {
      partnerCreditΔ: Decimal;
      liabilityΔ: Decimal;
      partnerLevels: { partnerId: string | null; amountΔ: Decimal }[];
      revenueΔ: Decimal;
      customerShortfall: Decimal;
    },
  ): Promise<string | null> {
    const [payable, liability, revenue] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: snap.partnerId }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
    ]);
    const partnerLegs = await Promise.all(
      amounts.partnerLevels.map(async (l) => {
        const account = await this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: l.partnerId! }, tx);
        return { accountId: account.id, direction: PostingDirection.DEBIT, amount: l.amountΔ };
      }),
    );
    const clearing = amounts.customerShortfall.greaterThan(0)
      ? await this.ledger.accountFor({ type: LedgerAccountType.CUSTOMER_SHORTFALL_CLEARING, userId: snap.customerId }, tx)
      : null;
    const postings = [
      ...(amounts.partnerCreditΔ.greaterThan(0)
        ? [{ accountId: payable.id, direction: PostingDirection.CREDIT, amount: amounts.partnerCreditΔ }]
        : []),
      ...(amounts.liabilityΔ.greaterThan(0) ? [{ accountId: liability.id, direction: PostingDirection.DEBIT, amount: amounts.liabilityΔ }] : []),
      ...partnerLegs,
      ...(amounts.revenueΔ.greaterThan(0) ? [{ accountId: revenue.id, direction: PostingDirection.DEBIT, amount: amounts.revenueΔ }] : []),
      ...(clearing ? [{ accountId: clearing.id, direction: PostingDirection.DEBIT, amount: amounts.customerShortfall }] : []),
    ];
    if (postings.length < 2) return null;
    const posted = await this.ledger.post(
      { kind: 'partner.contribution_refund', sourceType: source.sourceType, sourceId: source.sourceId, postings },
      tx,
    );
    return posted.id;
  }
}

/** Q9 netting, shared by online returns and QR refunds. */
export interface ShortfallNetting {
  /** Kept from the TuTak-money refund (first). */
  fromMoney: Decimal;
  /** Kept from the external/cash refund the partner hands back (second). */
  fromCash: Decimal;
  /** Still to be paid by the customer at the partner's desk. */
  collected: Decimal;
}

export function netShortfall(shortfall: Decimal, moneyRefund: Decimal, cashRefund: Decimal): ShortfallNetting {
  const fromMoney = Decimal.min(shortfall, moneyRefund);
  const fromCash = Decimal.min(shortfall.minus(fromMoney), cashRefund);
  return { fromMoney, fromCash, collected: shortfall.minus(fromMoney).minus(fromCash) };
}

/**
 * Thrown inside a return's transaction to roll it back when the customer's
 * shortfall cannot be recovered from the TuTak-money refund alone: the rest
 * is settled at the partner's desk first, and until then nothing moves (Q9:
 * "до решения возврат не финализируется").
 */
export class ShortfallSettlementRequired extends Error {
  constructor(readonly breakdown: ShortfallBreakdown) {
    super('shortfall settlement required');
  }
}

/** Thrown when the amounts to settle changed since the partner was shown them. */
export class ShortfallSettlementChanged extends Error {
  constructor(readonly breakdown: ShortfallBreakdown) {
    super('shortfall settlement changed');
  }
}

export interface ShortfallBreakdown {
  customerShortfall: Decimal;
  moneyGross: Decimal;
  cashGross: Decimal;
  netting: ShortfallNetting;
  referralWithheld: Decimal;
  expiredWrittenBack: Decimal;
  revenueReversed: Decimal;
}
