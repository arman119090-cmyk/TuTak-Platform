import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BonusEntryType,
  DeferredBonusLotStatus,
  LedgerAccountType,
  PostingDirection,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { BonusEngineService } from './bonus-engine.service';

type Tx = Prisma.TransactionClient;

/**
 * The 30% deferred/"black" pool share — spec §13-16. Deliberately not built
 * on `BonusLot`'s own PENDING→AVAILABLE machinery: that sweep promotes on
 * elapsed *time*, unconditionally, and a deferred lot's unlock condition is
 * cumulative *turnover*, not time. See
 * docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md §3 for the full reasoning.
 *
 * A `DeferredBonusLot` therefore never touches `Wallet`/`BonusLot` until the
 * moment it actually unlocks — the value is not spendable, and does not even
 * exist as a wallet balance, before that.
 */
@Injectable()
export class DeferredBonusLotService {
  private readonly logger = new Logger(DeferredBonusLotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Spec §15: applies one confirmed purchase's full gross amount to every
   * *existing* active deferred lot for this user whose window contains it,
   * unlocking any that cross their threshold — before the caller creates a
   * new lot from this same purchase's own deferred share. Called from
   * `PurchaseIntentService` inside its own transaction, in that order; this
   * method does not create the new lot itself, by design, so a purchase can
   * never progress its own newly-created lot.
   *
   * Records each lot's contribution in `DeferredBonusLotContribution` so a
   * later refund of this same `sourceTransactionId` can reverse precisely
   * what it added here — see `reverseExternalContributions` (independent
   * audit, GitHub issue #28).
   */
  async advanceExistingLots(
    userId: string,
    grossAmount: Decimal,
    sourceTransactionId: string,
    tx: Tx,
  ): Promise<void> {
    const now = new Date();
    const allLots = await tx.deferredBonusLot.findMany({
      where: { userId, status: DeferredBonusLotStatus.DEFERRED, deadline: { gte: now } },
    });
    // `refundedAmount` can only grow, and a fully-refunded lot has nothing
    // left to ever grant — filtered here in application code because
    // Prisma's `where` cannot compare one column against another
    // (`amount` vs `refundedAmount`). Without this, a later purchase
    // crossing such a lot's threshold hits `bonusEngine.accrue()` with a
    // zero amount, which `parsePositiveMoney` refuses — failing every
    // subsequent purchase this customer makes for as long as the lot stays
    // DEFERRED.
    const lots = allLots.filter((lot) => lot.refundedAmount.lessThan(lot.amount));

    for (const lot of lots) {
      // Atomic DB-side increment, not a read-modify-write of a JS-computed
      // absolute value: the enclosing transaction (PurchaseIntentsService
      // .settlePurchase) runs at Postgres's default READ COMMITTED, not
      // Serializable, so two purchases confirmed concurrently for the same
      // customer — each progressing this same lot — would otherwise both
      // read the same starting `progressTurnover`, both compute their own
      // "old + this purchase's amount", and the second UPDATE to commit
      // would silently overwrite the first's contribution rather than
      // stacking on top of it, permanently losing turnover the customer
      // genuinely earned. `{ increment: grossAmount }` is evaluated by
      // Postgres against the row's current value at write time, so this is
      // correct regardless of isolation level or how many purchases land at
      // once.
      const updated = await tx.deferredBonusLot.update({
        where: { id: lot.id },
        data: { progressTurnover: { increment: grossAmount } },
      });

      // Traceability for `reverseExternalContributions`: without this, a
      // refund of this purchase has no way to know it was this lot (among
      // possibly several) that received this turnover, or how much.
      await tx.deferredBonusLotContribution.create({
        data: { lotId: lot.id, sourceTransactionId, amount: grossAmount },
      });

      if (updated.progressTurnover.lessThan(updated.requiredTurnover)) {
        continue;
      }

      // Threshold crossed: unlock. Conditional on still being DEFERRED so a
      // concurrent second purchase applying to the same lot cannot unlock it
      // twice — mirrors the claim-then-act pattern the rest of this
      // codebase uses for exactly this reason. `progressTurnover` was
      // already committed atomically above; nothing left to set here but
      // the status transition.
      const claimed = await tx.deferredBonusLot.updateMany({
        where: { id: lot.id, status: DeferredBonusLotStatus.DEFERRED },
        data: {
          status: DeferredBonusLotStatus.AVAILABLE,
          unlockedAt: now,
        },
      });
      if (claimed.count === 0) continue;

      // The refunded slice was never actually earned by this purchase in
      // the end — only what remains grants.
      const grantable = lot.amount.minus(lot.refundedAmount);
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      const granted = await this.bonusEngine.accrue(
        {
          walletId: wallet.id,
          type: BonusEntryType.ACCRUAL_DEFERRED,
          amount: grantable,
          sourceTransactionId: lot.sourceTransactionId,
          pendingHours: 0,
          metadata: { deferredBonusLotId: lot.id },
        },
        tx,
      );
      await tx.deferredBonusLot.update({
        where: { id: lot.id },
        data: { grantedBonusLotId: granted.id },
      });
      this.logger.log(`Deferred bonus lot ${lot.id} unlocked for user ${userId}: ${grantable} AMD`);
    }
  }

  /**
   * Creates the new deferred lot generated by *this* purchase — spec §13.
   * Its `progressTurnover` starts at zero and this purchase's own gross
   * amount is not applied to it; only *later* purchases can (spec §15).
   */
  async createLot(
    userId: string,
    amount: Decimal,
    sourceTransactionId: string,
    tx: Tx,
  ): Promise<void> {
    if (amount.lessThanOrEqualTo(0)) return;
    const policy = this.config.get('purchasePolicy', { infer: true });
    const deadline = new Date();
    deadline.setMonth(deadline.getMonth() + policy.deferredWindowMonths);

    await tx.deferredBonusLot.create({
      data: {
        userId,
        sourceTransactionId,
        amount,
        requiredTurnover: policy.deferredRequiredTurnover,
        deadline,
      },
    });
  }

  /**
   * The deferred-lot half of a `PurchaseIntentRefundService` refund: reduces
   * the lot *this purchase itself created* (found by `sourceTransactionId`,
   * the same way its green accrual and referral accrual are found) by the
   * refund's proportional share, and claws back the wallet-side value too if
   * the lot had already unlocked.
   *
   * Deliberately does not touch *other* deferred lots this purchase's
   * `advanceExistingLots` may have progressed — nothing records which lot
   * received how much turnover from which purchase, so there is no
   * traceable amount to reverse there without inventing new bookkeeping this
   * refund is not the place to add.
   *
   * Returns `liabilityToReverse` — what the caller should actually debit
   * from `BONUS_LIABILITY` — and `shortfall`, the portion of `share` this
   * could not (or must not) reduce the liability for. The caller folds
   * `shortfall` into its own reversal's `PLATFORM_REVENUE` leg instead —
   * every posting must still balance to the same `poolΔ` regardless of
   * which account absorbs which piece — rather than silently dropping it,
   * which would leave the reversing entry unbalanced (independent audit,
   * GitHub issue #28, HEAD `0a9c7d5`):
   *
   *  - **Still `DEFERRED`** (never unlocked): nothing has touched this
   *    liability slice since confirmation, so the full reduction *is* what
   *    must come off `BONUS_LIABILITY` — `liabilityToReverse = reduceBy`,
   *    no shortfall.
   *  - **`AVAILABLE`** (unlocked, granted to the wallet): only the unspent
   *    remainder of the granted lot is real to claw back —
   *    `reverseAccrualLot`'s own return value, not the theoretical share.
   *    Whatever was already spent elsewhere is `shortfall`.
   *  - **`EXPIRED`** (or no lot found at all): `expireOne` already released
   *    this lot's full liability to `PLATFORM_REVENUE` — reversing
   *    `BONUS_LIABILITY` again here would debit it twice for the same
   *    amount, so `liabilityToReverse` is zero and the *entire* requested
   *    `share` is `shortfall`, not zero: it must still land somewhere in
   *    the caller's balanced posting, just not on `BONUS_LIABILITY`.
   *
   * Shares `refundedAmount` as its running total with `reverseUnlock` below
   * rather than tracking each mechanism's own history separately — and that
   * sharing is required, not incidental. `poolΔ`/`share` here is always the
   * *full* theoretical deferred slice of this purchase's own pool, credited
   * to `PARTNER_PAYABLE` unconditionally by the caller's own balanced
   * posting; this method's return values are the *only* place that credit
   * gets an offsetting debit, so `reduceBy` (and therefore `shortfall`) must
   * still reflect the *entire* remaining slice even when `reverseUnlock` got
   * to this same lot first — otherwise the caller's transaction would come
   * up short by whatever `reverseUnlock` already handled and
   * `LedgerService.post` would reject it as unbalanced (confirmed by an
   * earlier, reverted attempt at splitting the two into separate fields —
   * independent audit, GitHub issue #28). What looks like the same AMD
   * "double-crediting" `PLATFORM_REVENUE` across `reverseUnlock`'s posting
   * and this one is not a double count: `reverseUnlock` only ever credits
   * revenue for what it *actually* reclaimed from the wallet, and this
   * method's own reclaim attempt on an already-drained lot always comes back
   * empty (`reverseAccrualLot` returns `null` once a lot's remainder hits
   * zero) — so the two together can never recognize more revenue than the
   * lot's own `amount` ever supported, and a lot's *unspent* portion nets
   * cleanly back to zero across the two transactions when both purchases
   * are refunded, whichever order they land in.
   */
  async reverseForRefund(
    sourceTransactionId: string,
    share: Decimal,
    reason: string,
    tx: Tx,
  ): Promise<{ liabilityToReverse: Decimal; shortfall: Decimal }> {
    const zero = new Decimal(0);
    const lot = await tx.deferredBonusLot.findFirst({ where: { sourceTransactionId } });
    if (!lot || lot.status === DeferredBonusLotStatus.EXPIRED) {
      return { liabilityToReverse: zero, shortfall: share };
    }

    // `amounts_sane` requires `amount` to stay strictly positive for as
    // long as the row exists, so what's left to reverse is tracked in
    // `refundedAmount` rather than by decrementing `amount` itself.
    const reduceBy = Decimal.min(share, lot.amount.minus(lot.refundedAmount));
    if (reduceBy.lessThanOrEqualTo(0)) {
      return { liabilityToReverse: zero, shortfall: share };
    }

    await tx.deferredBonusLot.update({
      where: { id: lot.id },
      data: { refundedAmount: { increment: reduceBy } },
    });

    if (lot.status === DeferredBonusLotStatus.DEFERRED) {
      return { liabilityToReverse: reduceBy, shortfall: zero };
    }

    const clawed = lot.grantedBonusLotId
      ? await this.bonusEngine.reverseAccrualLot(lot.grantedBonusLotId, reason, reduceBy, tx)
      : null;
    const actual = clawed ?? zero;
    return { liabilityToReverse: actual, shortfall: reduceBy.minus(actual) };
  }

  /**
   * Reverses the turnover *this* purchase contributed to *other* lots via
   * `advanceExistingLots` — the gap `reverseForRefund` above documents as
   * out of scope for itself, closed by `DeferredBonusLotContribution`
   * (independent audit, GitHub issue #28).
   *
   * `EXPIRED` lots are left alone: `expireOne` already released that lot's
   * full liability to `PLATFORM_REVENUE`, so there is nothing left to claw
   * and no further posting to make — logged so the gap stays visible.
   *
   * A `DEFERRED` lot only has its `progressTurnover` reduced — nothing has
   * been granted yet, so there is no wallet-side value to claw back.
   *
   * An `AVAILABLE` lot also has its `progressTurnover` reduced, and if that
   * drop takes it back *below* `requiredTurnover`, the qualifying event that
   * unlocked it never actually happened — see `reverseUnlock` for how that
   * grant is undone.
   */
  async reverseExternalContributions(
    sourceTransactionId: string,
    amount: Decimal,
    reason: string,
    tx: Tx,
  ): Promise<void> {
    if (amount.lessThanOrEqualTo(0)) return;

    const contributions = await tx.deferredBonusLotContribution.findMany({
      where: { sourceTransactionId },
      include: { lot: true },
    });

    for (const contribution of contributions) {
      const reversible = contribution.amount.minus(contribution.reversedAmount);
      if (reversible.lessThanOrEqualTo(0)) continue;
      const reduceBy = Decimal.min(amount, reversible);
      if (reduceBy.lessThanOrEqualTo(0)) continue;

      if (contribution.lot.status === DeferredBonusLotStatus.EXPIRED) {
        this.logger.warn(
          `Purchase ${sourceTransactionId} refund: ${reduceBy.toString()} of turnover previously ` +
            `contributed to deferred bonus lot ${contribution.lotId} could not be reversed because the ` +
            `lot is already EXPIRED.`,
        );
        continue;
      }

      await tx.deferredBonusLotContribution.update({
        where: { id: contribution.id },
        data: { reversedAmount: { increment: reduceBy } },
      });
      const updatedLot = await tx.deferredBonusLot.update({
        where: { id: contribution.lotId },
        data: { progressTurnover: { decrement: reduceBy } },
      });

      if (
        updatedLot.status === DeferredBonusLotStatus.AVAILABLE &&
        updatedLot.progressTurnover.lessThan(updatedLot.requiredTurnover)
      ) {
        await this.reverseUnlock(updatedLot, reason, tx);
      }
    }
  }

  /**
   * Undoes a lot's unlock after a refund drops its `progressTurnover` back
   * below `requiredTurnover` — the qualifying turnover that crossed the
   * threshold has turned out not to be real, so the grant it produced must
   * not survive it (independent audit, GitHub issue #28).
   *
   * Idempotent by construction: `remaining = amount - refundedAmount` is
   * zero once a prior call (from an earlier refund, or a retried
   * transaction) has already fully clawed this lot, so a repeat is a
   * no-op — the same "running total, never re-derived" pattern
   * `reverseForRefund` and `expireOne` already use for exactly this reason.
   * `refundedAmount` is shared with `reverseForRefund` (the lot's *own*
   * originating purchase's refund path) rather than tracked separately —
   * see that method's docblock for why the sharing is required, not
   * incidental.
   *
   * `reverseAccrualLot` claws back only the *unspent* remainder of the
   * granted `BonusLot` and returns exactly that amount — never more than is
   * really sitting in the wallet, so this can never drive a balance
   * negative. Whatever was already spent (or independently expired) is
   * `shortfall`: its `BONUS_LIABILITY` was already released at the moment
   * it left the wallet (a redemption's own compensation posting, or that
   * `BonusLot`'s own expiry sweep) — crediting it again here would double
   * count, so `shortfall` gets no posting at all, only a log line, mirroring
   * `PurchaseIntentRefundService.reverseLoyaltyEffects`'s identical
   * reasoning for a purchase's own accrual.
   *
   * The recovered portion is posted independently of whatever refund
   * triggered this — DEBIT `BONUS_LIABILITY` / CREDIT `PLATFORM_REVENUE`,
   * the same two-leg shape `expireOne` already uses for "a liability that
   * will never be paid out" — because this lot's magnitude has no relation
   * to the *triggering* refund's own `poolΔ`; folding it into that refund's
   * own balanced posting would as often as not leave it unbalanced.
   *
   * Left `AVAILABLE` rather than reverted to `DEFERRED`: turning it back
   * into something `advanceExistingLots` could unlock a second time, or
   * `expireOverdueLots` could sweep, is a materially bigger behavior change
   * than "undo the grant" — `refundedAmount` reaching `amount` already
   * records, the same way a fully-refunded purchase's own lot does, that
   * nothing here is outstanding any more.
   */
  private async reverseUnlock(
    lot: { id: string; userId: string; amount: Decimal; refundedAmount: Decimal; grantedBonusLotId: string | null },
    reason: string,
    tx: Tx,
  ): Promise<void> {
    const remaining = lot.amount.minus(lot.refundedAmount);
    if (remaining.lessThanOrEqualTo(0)) return;

    const clawed = lot.grantedBonusLotId
      ? await this.bonusEngine.reverseAccrualLot(lot.grantedBonusLotId, reason, remaining, tx)
      : null;
    const actual = clawed ?? new Decimal(0);
    const shortfall = remaining.minus(actual);

    await tx.deferredBonusLot.update({
      where: { id: lot.id },
      data: { refundedAmount: { increment: remaining } },
    });

    if (shortfall.greaterThan(0)) {
      this.logger.warn(
        `Deferred bonus lot ${lot.id} unlock reversed: ${shortfall.toString()} of the ${remaining.toString()} ` +
          'granted could not be reclaimed from the wallet (already spent or expired) and was written off.',
      );
    }

    if (actual.greaterThan(0)) {
      const [bonusLiabilityAccount, revenueAccount] = await Promise.all([
        this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
        this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
      ]);
      await this.ledger.post(
        {
          kind: 'deferred_bonus.unlock_reversed',
          sourceType: 'DeferredBonusLot',
          sourceId: lot.id,
          postings: [
            { accountId: bonusLiabilityAccount.id, direction: PostingDirection.DEBIT, amount: actual },
            { accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: actual },
          ],
        },
        tx,
      );
    }

    this.logger.log(
      `Deferred bonus lot ${lot.id} unlock reversed for user ${lot.userId}: qualifying turnover dropped ` +
        `below threshold after a refund; ${actual.toString()} reclaimed from the wallet.`,
    );
  }

  /**
   * Spec §16: a lot whose deadline passes before it qualifies is released —
   * the customer's entitlement to it lapses. CONFIRMED business decision
   * (2026-08-16, hardening-audit §N item 1): the released value is
   * recognized as TuTak revenue at the moment it expires — see `expireOne`
   * for the ledger posting this now makes, atomically with the state
   * transition.
   */
  async expireOverdueLots(): Promise<number> {
    const overdue = await this.prisma.deferredBonusLot.findMany({
      where: { status: DeferredBonusLotStatus.DEFERRED, deadline: { lt: new Date() } },
    });
    let count = 0;
    for (const lot of overdue) {
      if (await this.expireOne(lot)) count += 1;
    }
    if (count > 0) {
      this.logger.log(`Expired ${count} deferred bonus lot(s) past their deadline`);
    }
    return count;
  }

  /**
   * One lot's expiry, claimed and posted atomically: `postContributionLedger`
   * already credited `BONUS_LIABILITY` for this lot's `amount` back when the
   * originating purchase confirmed (spec §14's deferred share is part of
   * that posting's `customerLiability` leg regardless of whether the lot
   * ever unlocks) — the ledger has been carrying this as a liability to the
   * customer since day one, even though the wallet itself never reflected it
   * as spendable (see the class docblock). Expiry without qualifying means
   * that liability will never be paid out, so it is released here — DEBIT
   * `BONUS_LIABILITY` — and the same amount becomes TuTak's own revenue —
   * CREDIT `PLATFORM_REVENUE` — in one transaction with the `EXPIRED`
   * claim, so a lot can never end up expired without the matching revenue
   * recognized, or vice versa.
   *
   * Only `amount - refundedAmount` is released: a `PurchaseIntentRefundService`
   * refund already debited `BONUS_LIABILITY` for whatever share it reversed
   * (see `reverseForRefund`'s `liabilityStillOutstanding`), so releasing the
   * original, un-reduced `amount` here would debit that same slice twice.
   */
  private async expireOne(lot: { id: string; amount: Decimal; refundedAmount: Decimal }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.deferredBonusLot.updateMany({
        where: { id: lot.id, status: DeferredBonusLotStatus.DEFERRED },
        data: { status: DeferredBonusLotStatus.EXPIRED, expiredAt: new Date() },
      });
      if (claimed.count === 0) return false;

      const releasable = lot.amount.minus(lot.refundedAmount);
      if (releasable.greaterThan(0)) {
        const [bonusLiabilityAccount, revenueAccount] = await Promise.all([
          this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
          this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
        ]);
        await this.ledger.post(
          {
            kind: 'deferred_bonus.expired',
            sourceType: 'DeferredBonusLot',
            sourceId: lot.id,
            postings: [
              { accountId: bonusLiabilityAccount.id, direction: PostingDirection.DEBIT, amount: releasable },
              { accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: releasable },
            ],
          },
          tx,
        );
      }
      return true;
    });
  }
}
