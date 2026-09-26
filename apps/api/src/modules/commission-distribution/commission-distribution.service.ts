import { Injectable } from '@nestjs/common';
import { BonusEntryType, LedgerAccountType, PostingDirection, Prisma, ReferrerType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { roundIssued } from '../../common/utils/money';
import { LedgerService } from '../ledger/ledger.service';
import {
  CURRENT_REFERRAL_PROGRAM_VERSION,
  ReferralChainLevel,
  ReferralPoolSplit,
  ReferralService,
} from '../referral/referral.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';

type Tx = Prisma.TransactionClient;

/**
 * The snapshot columns a distribution writes onto its own source row —
 * identical in name and meaning on `PurchaseIntent` and `PartnerOrder`, so
 * a later refund/return reverses the *historical* allocation from the row
 * itself and never re-walks the live referral chain or re-reads today's
 * `purchasePolicy`. See `PurchaseIntent`'s own schema docblock for the full
 * reasoning behind each column.
 */
export interface DistributionSnapshot {
  poolAmount: Decimal;
  greenAmount: Decimal;
  deferredAmount: Decimal;
  programVersion: typeof CURRENT_REFERRAL_PROGRAM_VERSION;
  referrer1Type: ReferrerType | null;
  referrer1UserId: string | null;
  referrer1PartnerId: string | null;
  referrer1Amount: Decimal;
  referrer2Type: ReferrerType | null;
  referrer2UserId: string | null;
  referrer2PartnerId: string | null;
  referrer2Amount: Decimal;
  referrer3Type: ReferrerType | null;
  referrer3UserId: string | null;
  referrer3PartnerId: string | null;
  referrer3Amount: Decimal;
  tutakAmount: Decimal;
}

export interface DistributionContext {
  customerId: string;
  /** The partner whose `PARTNER_PAYABLE` funds the pool. */
  partnerId: string;
  /**
   * The purchase amount this counts as toward the customer's already-open
   * deferred lots (spec §15) — the confirmed gross for a QR purchase, the
   * completed order total for an online order.
   */
  turnoverAmount: Decimal;
  /** The `Transaction` row every bonus lot this creates is keyed by. */
  sourceTransactionId: string;
  /** Where the contribution ledger posting points back to. */
  ledgerSource: { sourceType: string; sourceId: string };
}

/**
 * The one implementation of "a confirmed commission is distributed
 * 20/30/30/20" (spec §13) — green / deferred (black) / TuTak / the existing
 * 3-level referral chain — shared by the offline QR flow
 * (`PurchaseIntentsService.settlePurchase`) and online partner orders
 * (`PartnerOrdersService`, at customer receipt). Extracted verbatim from
 * `settlePurchase` rather than rewritten: same order of effects, same
 * rounding, same ledger shape, so the QR flow's behaviour is unchanged and
 * the online flow cannot drift from it (Partner Commerce v2, E1).
 *
 * Deliberately two steps. `plan()` resolves the referral chain and computes
 * the split *before* the caller's transaction (the chain is immutable once
 * attributed, spec §5, so reading it early is safe) and returns the
 * snapshot the caller writes in its own claim. `apply()` runs *inside* the
 * caller's transaction, after the claim, so every effect rolls back with
 * it.
 */
@Injectable()
export class CommissionDistributionService {
  constructor(
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly referralService: ReferralService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Spec §12: the pool is the commission base × the *snapshotted* rate,
   * rounded down to the column's own 4-decimal-place precision up front.
   */
  poolFor(base: Decimal, rateBps: number): Decimal {
    return roundIssued(base.times(rateBps).dividedBy(10_000));
  }

  async plan(customerId: string, base: Decimal, rateBps: number): Promise<ReferralPoolSplit> {
    const pool = this.poolFor(base, rateBps);
    const chain = await this.referralService.resolveReferralChain(customerId);
    return this.referralService.computePoolSplit(pool, chain);
  }

  snapshotOf(split: ReferralPoolSplit): DistributionSnapshot {
    const l1Entry = split.chain.find((c) => c.level === 1) ?? null;
    const l2Entry = split.chain.find((c) => c.level === 2) ?? null;
    const l3Entry = split.chain.find((c) => c.level === 3) ?? null;
    return {
      poolAmount: split.pool,
      greenAmount: split.green,
      deferredAmount: split.deferred,
      programVersion: CURRENT_REFERRAL_PROGRAM_VERSION,
      referrer1Type: l1Entry?.type ?? null,
      referrer1UserId: l1Entry?.type === 'USER' ? l1Entry.userId : null,
      referrer1PartnerId: l1Entry?.type === 'PARTNER' ? l1Entry.partnerId : null,
      referrer1Amount: split.l1,
      referrer2Type: l2Entry?.type ?? null,
      referrer2UserId: l2Entry?.type === 'USER' ? l2Entry.userId : null,
      referrer2PartnerId: l2Entry?.type === 'PARTNER' ? l2Entry.partnerId : null,
      referrer2Amount: split.l2,
      referrer3Type: l3Entry?.type ?? null,
      referrer3UserId: l3Entry?.type === 'USER' ? l3Entry.userId : null,
      referrer3PartnerId: l3Entry?.type === 'PARTNER' ? l3Entry.partnerId : null,
      referrer3Amount: split.l3,
      tutakAmount: split.tutak,
    };
  }

  /**
   * Every effect of one distribution, in exactly the order `settlePurchase`
   * always ran them: the customer's green accrual, progress on the
   * customer's *existing* deferred lots, then this purchase's own new
   * deferred lot (spec §15 — never the other order), every USER-type
   * referral level's wallet share, and finally the balanced contribution
   * posting that funds all of it from the partner's `PARTNER_PAYABLE`.
   */
  async apply(split: ReferralPoolSplit, ctx: DistributionContext, tx: Tx): Promise<void> {
    const { green, deferred, l1, l2, l3 } = split;

    if (green.greaterThan(0)) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: ctx.customerId } });
      await this.bonusEngine.accrue(
        {
          walletId: wallet.id,
          type: BonusEntryType.ACCRUAL_PURCHASE,
          amount: green,
          sourceTransactionId: ctx.sourceTransactionId,
          pendingHours: 0,
        },
        tx,
      );
    }

    await this.deferredBonusLots.advanceExistingLots(ctx.customerId, ctx.turnoverAmount, ctx.sourceTransactionId, tx);
    if (deferred.greaterThan(0)) {
      await this.deferredBonusLots.createLot(ctx.customerId, deferred, ctx.sourceTransactionId, tx);
    }

    // Every USER-type level (L1/L2/L3) is credited straight into its
    // wallet; a PARTNER-type level is deliberately skipped here — its share
    // is the ledger-only leg `postContribution` posts below.
    await this.referralService.creditChainShares(split.chain, { l1, l2, l3 }, ctx.sourceTransactionId, tx);

    await this.postContribution(split, ctx, tx);
  }

  /**
   * Spec §12 + §22-24: the full contribution pool, split by who receives
   * each slice, as one balanced double-entry transaction. A USER-type
   * level's share is folded into the same `BONUS_LIABILITY` credit as
   * green/deferred (it is spendable wallet value); a PARTNER-type level
   * gets its own `PARTNER_PAYABLE` credit. `tutak` is already the pool's
   * residual (`ReferralService.computePoolSplit`).
   *
   * Deliberately *not* passing `tx` to any `accountFor` call — see the
   * self-deadlock note this was moved with: an account created inside the
   * still-open transaction is invisible to a sibling tx-less lookup, whose
   * insert then blocks on this transaction's own uncommitted row.
   */
  private async postContribution(split: ReferralPoolSplit, ctx: DistributionContext, tx: Tx): Promise<void> {
    if (split.pool.lessThanOrEqualTo(0)) return;

    const [partnerAccount, bonusLiabilityAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: ctx.partnerId }),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }),
    ]);

    const byLevel: Record<1 | 2 | 3, Decimal> = { 1: split.l1, 2: split.l2, 3: split.l3 };
    const userLiability = split.chain
      .filter((c) => c.type === 'USER')
      .reduce((sum, c) => sum.plus(byLevel[c.level]), new Decimal(0));
    const customerLiability = split.green.plus(split.deferred).plus(userLiability);

    const partnerReferrerPostings = await Promise.all(
      split.chain
        .filter((c): c is ReferralChainLevel & { type: 'PARTNER' } => c.type === 'PARTNER')
        .map(async (c) => {
          const share = byLevel[c.level];
          if (share.lessThanOrEqualTo(0)) return null;
          const account = await this.ledger.accountFor({
            type: LedgerAccountType.PARTNER_PAYABLE,
            partnerId: c.partnerId,
          });
          return { accountId: account.id, direction: PostingDirection.CREDIT, amount: share };
        }),
    );

    const postings = [
      { accountId: partnerAccount.id, direction: PostingDirection.DEBIT, amount: split.pool },
      ...(customerLiability.greaterThan(0)
        ? [{ accountId: bonusLiabilityAccount.id, direction: PostingDirection.CREDIT, amount: customerLiability }]
        : []),
      ...partnerReferrerPostings.filter((p): p is NonNullable<typeof p> => p !== null),
      ...(split.tutak.greaterThan(0)
        ? [{ accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: split.tutak }]
        : []),
    ];

    await this.ledger.post(
      {
        kind: 'partner.contribution',
        sourceType: ctx.ledgerSource.sourceType,
        sourceId: ctx.ledgerSource.sourceId,
        postings,
      },
      tx,
    );
  }
}
