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
    // `refundedAmount` + `forfeitedAmount` can only grow, and a lot with
    // nothing left of `amount` beyond those two has nothing left to ever
    // grant — filtered here in application code because Prisma's `where`
    // cannot compare one column against the sum of two others. Without
    // this, a later purchase crossing such a lot's threshold hits
    // `bonusEngine.accrue()` with a zero amount, which `parsePositiveMoney`
    // refuses — failing every subsequent purchase this customer makes for
    // as long as the lot stays DEFERRED. A lot `reverseUnlock` reverted to
    // DEFERRED after clawing back an invalidated grant is deliberately
    // *not* excluded here purely by having gone through that once — only
    // the two running totals above ever permanently close it out
    // (independent audit, GitHub issue #28).
    const lots = allLots.filter((lot) => lot.refundedAmount.plus(lot.forfeitedAmount).lessThan(lot.amount));

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

      // The refunded slice (this lot's own purchase, partially or fully
      // refunded) and the forfeited slice (permanently written off by a
      // *past* `reverseUnlock` clawback that could not fully reclaim an
      // earlier invalidated grant — see that method) were never actually
      // earned or are already gone; only what remains ever grants, whether
      // this is the lot's first unlock or a later re-qualification.
      const grantable = lot.amount.minus(lot.refundedAmount).minus(lot.forfeitedAmount);
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
   * the lot is currently unlocked with a live grant.
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
   *  - **`DEFERRED`** (never unlocked, or reverted there by `reverseUnlock`
   *    after clawing back an earlier invalidated grant): nothing is
   *    currently vested in a wallet, so the full reduction *is* what must
   *    come off `BONUS_LIABILITY` — `liabilityToReverse = reduceBy`, no
   *    shortfall. This is correct even after a past `reverseUnlock`: the
   *    *reclaimed* (unspent) portion of that invalidated grant was never
   *    posted anywhere by `reverseUnlock` — see its own docblock — so it is
   *    still sitting in `BONUS_LIABILITY` exactly as if it had never
   *    vested, and this refund is what finally, genuinely releases it.
   *  - **`AVAILABLE`** (a live grant currently exists — this lot's most
   *    recent unlock, whether its first or a later re-qualification, is
   *    still standing): only the unspent remainder of *that* granted lot is
   *    real to claw back — `reverseAccrualLot`'s own return value, not the
   *    theoretical share. Whatever was already spent from it is `shortfall`.
   *  - **`EXPIRED`** (or no lot found at all): `expireOne` already released
   *    this lot's full liability to `PLATFORM_REVENUE` — reversing
   *    `BONUS_LIABILITY` again here would debit it twice for the same
   *    amount, so `liabilityToReverse` is zero and the *entire* requested
   *    `share` is `shortfall`, not zero: it must still land somewhere in
   *    the caller's balanced posting, just not on `BONUS_LIABILITY`.
   *
   * `refundedAmount` (this method's own running total) and `forfeitedAmount`
   * (`reverseUnlock`'s — see that method) together form this lot's ceiling:
   * `amount - refundedAmount - forfeitedAmount` is what's left to ever
   * process, from *either* mechanism, for the rest of this lot's life. Any
   * requested `share` beyond that ceiling is *not* a real remaining
   * liability — `reverseUnlock` already permanently forfeited (and posted
   * revenue for) that slice when an earlier grant on this lot was clawed
   * back partly-spent — so it folds into `shortfall` here too, exactly like
   * the `EXPIRED` case, rather than being silently dropped or debited from
   * `BONUS_LIABILITY` a second time (independent audit, GitHub issue #28:
   * an earlier version of this fix instead made `reverseUnlock` forfeit a
   * clawed-back grant's *entire* remaining value, unspent portion included,
   * which correctly avoided double-crediting revenue but destroyed the
   * lot's ability to ever requalify — reverted once that surfaced against a
   * concurrent audit's regression test).
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
    // `refundedAmount`/`forfeitedAmount` rather than by decrementing
    // `amount` itself.
    const ceiling = lot.amount.minus(lot.refundedAmount).minus(lot.forfeitedAmount);
    const reduceBy = Decimal.min(share, Decimal.max(ceiling, zero));
    // Whatever `share` the ceiling itself could not accommodate was already
    // permanently forfeited-and-revenue-recognized by a past `reverseUnlock`
    // — folded into this transaction's own shortfall so `share` still lands
    // somewhere in this balanced posting, without debiting `BONUS_LIABILITY`
    // for it again.
    const ceilingGap = share.minus(reduceBy);
    if (reduceBy.lessThanOrEqualTo(0)) {
      return { liabilityToReverse: zero, shortfall: share };
    }

    await tx.deferredBonusLot.update({
      where: { id: lot.id },
      data: { refundedAmount: { increment: reduceBy } },
    });

    if (lot.status === DeferredBonusLotStatus.DEFERRED) {
      return { liabilityToReverse: reduceBy, shortfall: ceilingGap };
    }

    if (!lot.grantedBonusLotId) {
      return { liabilityToReverse: zero, shortfall: reduceBy.plus(ceilingGap) };
    }
    const clawed = await this.bonusEngine.reverseAccrualLot(lot.grantedBonusLotId, reason, reduceBy, tx);
    const actual = clawed ?? zero;

    // If that fully drained the currently-live grant, clear the pointer to
    // it: a *later* external-contributor refund dropping this same lot
    // below threshold must find nothing left to claw (`reverseUnlock`'s own
    // `!grantedBonusLotId` guard) rather than mistake this already-handled
    // value for newly-discovered spend and forfeit it a second time
    // (independent audit, GitHub issue #28 — caught by this fix's own
    // concurrent/mixed-refund regression test).
    const grantedLotAfter = await tx.bonusLot.findUnique({
      where: { id: lot.grantedBonusLotId },
      select: { remainingAmount: true },
    });
    if (!grantedLotAfter || grantedLotAfter.remainingAmount.isZero()) {
      await tx.deferredBonusLot.update({ where: { id: lot.id }, data: { grantedBonusLotId: null } });
    }

    return { liabilityToReverse: actual, shortfall: reduceBy.minus(actual).plus(ceilingGap) };
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
   * not survive it. But this lot's *own* originating purchase was never
   * touched: the underlying entitlement it funded is still fully valid, so
   * this must not permanently destroy it — the lot has to be able to
   * accumulate genuine turnover again and unlock exactly once more for
   * whatever is still owed (independent audit, GitHub issue #28: an earlier
   * version of this method left the lot `AVAILABLE` forever with
   * `refundedAmount` driven up to `amount`, which — combined with
   * `advanceExistingLots` only ever progressing `DEFERRED` lots — silently
   * and permanently under-credited every customer this ever happened to).
   *
   * Idempotent by construction: `grantedBonusLotId` is cleared to `null`
   * once a prior call (from an earlier refund, or a retried transaction)
   * has already clawed this lot's live grant back, so a repeat is a no-op —
   * the caller's own status check (only `AVAILABLE` lots reach here) already
   * guarantees this in the normal path; the guard below is defense in depth.
   *
   * `reverseAccrualLot` claws back the granted `BonusLot`'s entire *unspent*
   * remainder — the whole current grant is invalid, not some fraction of
   * it — and returns exactly that amount, never more than is really sitting
   * in the wallet, so this can never drive a balance negative. Comparing
   * that against the granted lot's own `originalAmount` (what this specific
   * unlock actually granted — its *first* unlock or a later
   * re-qualification's, whichever most recently happened) splits the grant
   * into two economically different pieces:
   *
   *  - **Reclaimed (unspent):** genuinely taken back — the customer never
   *    keeps it. This does *not* become `forfeitedAmount`, and gets no
   *    ledger posting at all: `BONUS_LIABILITY` was never actually
   *    *extinguished* by vesting this into a wallet in the first place (see
   *    the class docblock — the liability was booked once, at the
   *    originating purchase's confirmation, and stays booked until that
   *    purchase is refunded, the lot expires unqualified, or the customer
   *    genuinely spends it). Un-vesting it back to contingent, outstanding
   *    `BONUS_LIABILITY` is exactly correct — and leaves it available to
   *    grant again in full if this lot re-qualifies.
   *  - **Spent (unrecoverable):** the customer already redeemed this real
   *    value against a real purchase before the clawback could reach it —
   *    gone forever, and *this* portion permanently shrinks what this lot
   *    can ever grant again (`forfeitedAmount`, alongside `refundedAmount`
   *    — see `reverseForRefund`'s docblock for why both are needed and
   *    what each protects against double-processing). Its `BONUS_LIABILITY`
   *    is released for real, right now — DEBIT `BONUS_LIABILITY` / CREDIT
   *    `PLATFORM_REVENUE`, the same two-leg shape `expireOne` already uses
   *    for "a liability that will never be paid out" — because we know for
   *    certain this specific AMD will never be paid out again, regardless
   *    of what happens to the rest of the lot.
   *
   * Reverted to `DEFERRED` (not left `AVAILABLE`) with `grantedBonusLotId`
   * and `unlockedAt` cleared: `progressTurnover` was already brought back
   * below `requiredTurnover` by the caller before this runs, so the lot is
   * left in exactly the state it would be in had it simply never crossed
   * the threshold — `advanceExistingLots` can accumulate further genuine
   * turnover against it and unlock it again, exactly once, for whatever
   * remains once `refundedAmount` and `forfeitedAmount` are accounted for.
   */
  private async reverseUnlock(
    lot: { id: string; userId: string; grantedBonusLotId: string | null },
    reason: string,
    tx: Tx,
  ): Promise<void> {
    if (!lot.grantedBonusLotId) return;

    const grantedLot = await tx.bonusLot.findUnique({
      where: { id: lot.grantedBonusLotId },
      select: { originalAmount: true },
    });
    if (!grantedLot) return;

    const clawed = await this.bonusEngine.reverseAccrualLot(lot.grantedBonusLotId, reason, undefined, tx);
    const actual = clawed ?? new Decimal(0);
    const spent = grantedLot.originalAmount.minus(actual);

    await tx.deferredBonusLot.update({
      where: { id: lot.id },
      data: {
        status: DeferredBonusLotStatus.DEFERRED,
        grantedBonusLotId: null,
        unlockedAt: null,
        ...(spent.greaterThan(0) ? { forfeitedAmount: { increment: spent } } : {}),
      },
    });

    if (spent.greaterThan(0)) {
      this.logger.warn(
        `Deferred bonus lot ${lot.id} unlock reversed: ${spent.toString()} of the ${grantedLot.originalAmount.toString()} ` +
          'granted had already been spent and could not be reclaimed — permanently forfeited and released to platform revenue.',
      );

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
            { accountId: bonusLiabilityAccount.id, direction: PostingDirection.DEBIT, amount: spent },
            { accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: spent },
          ],
        },
        tx,
      );
    }

    this.logger.log(
      `Deferred bonus lot ${lot.id} unlock reversed for user ${lot.userId}: qualifying turnover dropped below ` +
        `threshold after a refund; ${actual.toString()} reclaimed and returned to outstanding liability, ` +
        `${spent.toString()} forfeited. Reverted to DEFERRED to accumulate turnover again.`,
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
   * Only `amount - refundedAmount - forfeitedAmount` is released: a
   * `PurchaseIntentRefundService` refund already debited `BONUS_LIABILITY`
   * for whatever share it reversed (`reverseForRefund`), and a past
   * `reverseUnlock` clawback may already have permanently forfeited (and
   * released to revenue) part of this lot if an earlier, since-invalidated
   * unlock had been partly spent — releasing either slice again here would
   * debit `BONUS_LIABILITY` twice for the same AMD (independent audit,
   * GitHub issue #28).
   */
  private async expireOne(
    lot: { id: string; amount: Decimal; refundedAmount: Decimal; forfeitedAmount: Decimal },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.deferredBonusLot.updateMany({
        where: { id: lot.id, status: DeferredBonusLotStatus.DEFERRED },
        data: { status: DeferredBonusLotStatus.EXPIRED, expiredAt: new Date() },
      });
      if (claimed.count === 0) return false;

      const releasable = lot.amount.minus(lot.refundedAmount).minus(lot.forfeitedAmount);
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
