import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BonusEntryType,
  EvCdrReconciliation,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  ReferralProgramVersion,
  ReferrerType,
  TransactionStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { roundCharge, roundIssued } from '../../common/utils/money';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { ReferralService, ResolvedReferrer } from '../referral/referral.service';
import { LedgerService } from '../ledger/ledger.service';
import { OCPI_ADAPTER, OcpiAdapter } from './ocpi/ocpi-adapter.interface';

type Tx = Prisma.TransactionClient;

/** One stored (never re-walked) snapshot level of a THREE_LEVEL_V2 `EvSession`'s referrer chain. */
interface SnapshotLevel {
  level: 1 | 2 | 3;
  type: ReferrerType | null;
  userId: string | null;
  partnerId: string | null;
  amount: Decimal;
}

/**
 * How far our figure and the CPO's may differ before it counts as a
 * disagreement.
 *
 * Not zero. Two meters read the same delivery, the tariff is applied at two
 * different moments, and each side rounds — a few hundredths of a dram apart
 * is two systems agreeing, not a discrepancy. One whole currency unit is
 * comfortably above that noise and far below anything worth a customer's
 * attention.
 */
const TOLERANCE = new Decimal('1');

/** How many times a CDR is asked for before it is somebody's problem. */
const MAX_FETCH_ATTEMPTS = 12;

/**
 * How long a `reconcilingAt` claim is honored before a later pass may
 * reclaim it. Comfortably above one CDR's worst-case processing time (a
 * single `fetchCdr` call times out at 15s; everything else is a handful of
 * DB writes) so a genuinely still-running claim is never stolen, while a
 * claim left behind by a process that died mid-reconcile does not block that
 * CDR forever.
 */
const RECONCILE_CLAIM_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Settling a roaming session against the operator who actually delivered it.
 *
 * On TuTak's own stations there is one meter and it is ours. On a roaming
 * station there are two: ours, fed by whatever the client reports, and the
 * CPO's, which is attached to the cable. Theirs is authoritative — they own
 * the hardware and they will invoice the platform from it — so a session
 * billed on ours and never compared with theirs is a number the platform
 * cannot defend to either the customer or the network.
 *
 * The CPO settles a CDR asynchronously, minutes to hours after the plug comes
 * out, so this cannot happen at stop time. `ev.reconcile-roaming-cdrs` polls
 * for them.
 *
 * ## The asymmetry, which is deliberate
 *
 * **They delivered less than we billed** → we return the difference, without
 * asking. We took something that was not ours.
 *
 * **They delivered more than we billed** → we do *not* quietly take more.
 * Going back into a customer's wallet days after they drove away, for a
 * number they never saw and cannot check, is not a correction — it is a
 * second charge. It is recorded, it is alerted, and a human decides whether
 * to invoice, absorb it, or dispute the CDR.
 *
 * That asymmetry costs the platform money in the aggregate. It is the right
 * way round anyway: the customer cannot audit either meter, so the party who
 * can should carry the ambiguity.
 */
@Injectable()
export class EvCdrReconciliationService {
  private readonly logger = new Logger(EvCdrReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly referralService: ReferralService,
    private readonly ledger: LedgerService,
    private readonly alerts: AlertsService,
    @Inject(OCPI_ADAPTER) private readonly ocpiAdapter: OcpiAdapter,
  ) {}

  /** Polls every roaming CDR still waiting on its operator. */
  async reconcilePending(): Promise<number> {
    const pending = await this.prisma.evCdr.findMany({
      where: { reconciliation: EvCdrReconciliation.PENDING },
      orderBy: { createdAt: 'asc' },
      include: { session: true },
      take: 200,
    });

    let settled = 0;
    for (const cdr of pending) {
      try {
        if (await this.reconcileOne(cdr.id)) settled += 1;
      } catch (err) {
        // One operator being unreachable must not stop the others being
        // settled, and the row stays PENDING for the next pass.
        this.logger.error(
          `Could not reconcile CDR ${cdr.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (settled > 0) this.logger.log(`Reconciled ${settled} roaming CDR(s)`);
    return settled;
  }

  /** Returns true when the CDR reached a terminal state on this pass. */
  private async reconcileOne(cdrId: string): Promise<boolean> {
    // Claim the row before doing anything that costs money — same idiom as
    // `EvSessionsService.stopOnce`'s `stoppedAt` claim. The sweep's advisory
    // Redis lock is not authoritative (a run stalled past its TTL by a
    // slow/unreachable CPO can overlap with the next scheduled run), and
    // `correctOvercharge`'s wallet-crediting step has no dedupe of its own —
    // without this, two overlapping runs reconciling the same still-PENDING
    // CDR could double-credit a customer's overcharge refund (independent
    // audit, GitHub issue #28). A stale claim (a process that died
    // mid-reconcile) is reclaimable after `RECONCILE_CLAIM_STALE_AFTER_MS`.
    const staleBefore = new Date(Date.now() - RECONCILE_CLAIM_STALE_AFTER_MS);
    const claimed = await this.prisma.evCdr.updateMany({
      where: {
        id: cdrId,
        reconciliation: EvCdrReconciliation.PENDING,
        OR: [{ reconcilingAt: null }, { reconcilingAt: { lt: staleBefore } }],
      },
      data: { reconcilingAt: new Date() },
    });
    if (claimed.count === 0) return false;

    const cdr = await this.prisma.evCdr.findUniqueOrThrow({
      where: { id: cdrId },
      include: { session: true },
    });

    const remoteId = cdr.session.ocpiCdrId ?? cdr.session.id;
    const remote = await this.ocpiAdapter.fetchCdr(remoteId);

    if (!remote) {
      const attempts = cdr.fetchAttempts + 1;
      // Release the claim: the CDR stays PENDING for a later pass, and that
      // later pass must be able to claim it again.
      await this.prisma.evCdr.update({
        where: { id: cdr.id },
        data: { fetchAttempts: attempts, reconcilingAt: null },
      });
      if (attempts >= MAX_FETCH_ATTEMPTS) {
        await this.giveUp(cdr.id, cdr.sessionId, attempts);
        return true;
      }
      return false;
    }

    const cpoCost = roundCharge(remote.totalCost);
    const cpoEnergy = new Decimal(remote.totalEnergyKwh).toDecimalPlaces(3);
    const billed = cdr.totalCost;
    const difference = billed.minus(cpoCost);

    if (difference.abs().lessThanOrEqualTo(TOLERANCE)) {
      await this.settle(cdr.id, EvCdrReconciliation.MATCHED, cpoEnergy, cpoCost, remote);
      return true;
    }

    if (difference.greaterThan(0)) {
      // We billed more than was delivered. Give it back.
      await this.correctOvercharge(cdr.id, cdr.sessionId, difference, cpoEnergy, cpoCost, remote);
      return true;
    }

    // We billed less. Recorded and escalated, never silently taken.
    await this.settle(cdr.id, EvCdrReconciliation.UNDERBILLED, cpoEnergy, cpoCost, remote);
    await this.alerts.fire({
      severity: 'warning',
      key: `ev.cdr.underbilled:${cdr.sessionId}`,
      title: 'A charging network delivered more than we charged for',
      body:
        `The operator's settled CDR is ${cpoCost.toString()} against the ` +
        `${billed.toString()} we billed. The customer has not been charged the difference and ` +
        'will not be automatically — going back into their wallet days later for a figure they ' +
        'never saw is a second charge, not a correction. Decide whether to invoice the ' +
        'difference, absorb it, or dispute the CDR with the operator.',
      context: {
        sessionId: cdr.sessionId,
        billed: billed.toString(),
        operator: cpoCost.toString(),
        shortfall: difference.abs().toString(),
      },
    });
    return true;
  }

  /**
   * Returns an overcharge to the customer.
   *
   * Three things move, and they have to move together or the wallet stops
   * reconstructing from its own ledger:
   *
   *  1. the transaction is corrected down to what was actually delivered;
   *  2. the points accrued on the inflated figure are clawed back in
   *     proportion — the customer earned them on money they did not spend;
   *  3. if they paid with points and the corrected cost is now lower than
   *     what they applied, the excess points go back.
   *
   * All of it — including the CDR's own terminal-state write via `settle` —
   * runs inside one transaction. It used to be four separate commits, with
   * the two wallet-moving steps caught-and-logged rather than thrown, so a
   * crash between a wallet mutation and the final `settle()` left the CDR
   * `PENDING` with the correction already (partly) applied — a later,
   * legitimate reclaim of the stale `reconcilingAt` claim would then apply
   * it again — and a thrown error from either wallet step was silently
   * swallowed while the CDR was *still* marked `CORRECTED` right after,
   * permanently skipping a correction that never actually happened
   * (independent audit, GitHub issue #28: a second-pass finding against
   * this file's own concurrency fix). One transaction makes both
   * impossible: either every step commits together, including the CDR
   * leaving `PENDING`, or none of them do and the CDR stays `PENDING` for a
   * genuine retry — nothing is ever half-applied or silently dropped.
   */
  private async correctOvercharge(
    cdrId: string,
    sessionId: string,
    difference: Decimal,
    cpoEnergy: Decimal,
    cpoCost: Decimal,
    remote: { ocpiCdrId: string; totalTimeSec: number; raw: unknown },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.evSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { transaction: true, connector: { include: { station: true } } },
      });
      const transaction = session.transaction;

      if (transaction && transaction.status === TransactionStatus.COMPLETED) {
        const originalCost = transaction.amount;
        const applied = transaction.bonusAppliedAmount;

        // Points earned — across every leg the pool split grants, not just
        // the customer's own green share — on money that was never spent.
        //
        // `session.greenAmount`/`deferredAmount`/etc. are the *historical*
        // snapshot `EvSessionsService.stopOnce` actually posted (independent
        // audit, GitHub issue #28: recomputing from today's `purchasePolicy`
        // would claw back different amounts than the ones on the books).
        // `poolAmount` null means this session never reached the
        // earning-eligible branch at all — nothing was split, so there is
        // nothing here to claw back.
        //
        // `programVersion` (2026-08-22 3-level rework) picks which snapshot
        // shape is authoritative — never re-derived from today's referral
        // chain (spec: a correction must never re-walk the current chain).
        if (session.poolAmount && session.poolAmount.greaterThan(0)) {
          const paidPortionBefore = Decimal.max(originalCost.minus(applied), new Decimal(1));
          const paidPortionAfter = cpoCost.minus(Decimal.min(applied, cpoCost));
          const clawbackShare = (granted: Decimal): Decimal => {
            const keep = roundIssued(granted.times(paidPortionAfter).dividedBy(paidPortionBefore));
            return Decimal.max(granted.minus(keep), new Decimal(0));
          };

          if (session.programVersion === ReferralProgramVersion.THREE_LEVEL_V2) {
            await this.correctOverchargeLegsV2(tx, session, transaction.id, clawbackShare);
          } else {
            await this.correctOverchargeLegsLegacy(tx, session, transaction.id, clawbackShare);
          }
        }

        // Points spent on a bill that turned out to be smaller than the hold.
        if (applied.greaterThan(cpoCost)) {
          const excess = applied.minus(cpoCost);
          const wallet = await tx.wallet.findUnique({ where: { userId: session.userId } });
          if (wallet) {
            await this.bonusEngine.accrue(
              {
                walletId: wallet.id,
                type: 'ACCRUAL_MANUAL_ADJUSTMENT',
                amount: excess,
                pendingHours: 0,
                sourceTransactionId: transaction.id,
                metadata: { reason: 'ev_cdr_overbilled', sessionId },
              },
              tx,
            );
          }
        }

        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            amount: cpoCost,
            metadata: {
              ...((transaction.metadata as Record<string, unknown> | null) ?? {}),
              correctedFrom: originalCost.toString(),
              correctedBy: 'roaming_cdr',
              operatorEnergyKwh: cpoEnergy.toString(),
            },
          },
        });
      }

      await this.settle(cdrId, EvCdrReconciliation.CORRECTED, cpoEnergy, cpoCost, remote, tx);
    });

    this.logger.warn(
      `Session ${sessionId} over-billed by ${difference.toString()}; corrected to ${cpoCost.toString()}`,
    );
    await this.alerts.fire({
      severity: 'warning',
      key: `ev.cdr.corrected:${sessionId}`,
      title: 'A charging session was billed more than the operator delivered',
      body:
        `The difference of ${difference.toString()} has been returned to the customer and the ` +
        'transaction corrected. Repeated corrections against one station mean its meter or its ' +
        'tariff disagrees with ours and the integration needs looking at, not just this session.',
      context: {
        sessionId,
        billed: difference.plus(cpoCost).toString(),
        operator: cpoCost.toString(),
        returned: difference.toString(),
      },
    });
  }

  /**
   * LEGACY single-level program only (`session.programVersion` null) — the
   * exact clawback logic this file always had, moved into its own method
   * unchanged so `correctOvercharge` can dispatch on `programVersion`
   * instead of re-deriving the split it should reverse.
   */
  private async correctOverchargeLegsLegacy(
    tx: Tx,
    session: {
      userId: string;
      poolAmount: Decimal | null;
      greenAmount: Decimal | null;
      deferredAmount: Decimal | null;
      referrerAmount: Decimal | null;
      tutakUpfrontAmount: Decimal | null;
      connector: { station: { partnerId: string } };
    },
    transactionId: string,
    clawbackShare: (granted: Decimal) => Decimal,
  ): Promise<void> {
    const poolAmount = session.poolAmount ?? new Decimal(0);
    const greenAmount = session.greenAmount ?? new Decimal(0);
    const deferredAmount = session.deferredAmount ?? new Decimal(0);
    const referrerAmount = session.referrerAmount ?? new Decimal(0);
    const tutakUpfrontAmount = session.tutakUpfrontAmount ?? new Decimal(0);
    // The remainder's own tutak share — never independently stored,
    // rebuilt from the same four snapshot columns
    // `postEvContributionLedgerIdempotent` itself derives
    // `tutakBaseOfRemainder` from, so a clawback on it uses exactly the
    // value the original posting actually credited.
    const tutakBaseAmount = poolAmount
      .minus(tutakUpfrontAmount)
      .minus(greenAmount)
      .minus(deferredAmount)
      .minus(referrerAmount);

    const greenClawback = clawbackShare(greenAmount);
    const deferredClawback = clawbackShare(deferredAmount);
    const referrerClawback = clawbackShare(referrerAmount);
    const tutakUpfrontClawback = clawbackShare(tutakUpfrontAmount);
    const tutakBaseClawback = clawbackShare(tutakBaseAmount);

    // Resolved once regardless of which legs are non-zero — needed for both
    // the wallet-side referral-lot reversal below and the ledger
    // correction's routing (a USER referrer's share lives in bonus
    // liability, a PARTNER referrer's in their own payable). Legacy-only:
    // this row predates the 3-level rework, so its single referrer is still
    // resolved live — same as `PurchaseIntentRefundService`'s own legacy path.
    const referrer = await this.referralService.resolveReferrer(session.userId);

    if (greenClawback.greaterThan(0)) {
      const greenLot = await tx.bonusLot.findFirst({
        where: { sourceTransactionId: transactionId, type: BonusEntryType.ACCRUAL_PURCHASE },
      });
      if (greenLot) {
        await this.bonusEngine.reverseAccrualLot(greenLot.id, 'ev_cdr_overbilled', greenClawback, tx);
      }
    }

    if (deferredClawback.greaterThan(0)) {
      await this.deferredBonusLots.reverseForRefund(transactionId, deferredClawback, 'ev_cdr_overbilled', tx);
    }

    if (referrerClawback.greaterThan(0) && referrer?.type === 'USER') {
      const referrerWallet = await tx.wallet.findUnique({ where: { userId: referrer.userId } });
      const referralLot = referrerWallet
        ? await tx.bonusLot.findFirst({
            where: {
              sourceTransactionId: transactionId,
              type: BonusEntryType.ACCRUAL_REFERRAL,
              walletId: referrerWallet.id,
            },
          })
        : null;
      if (referralLot) {
        await this.bonusEngine.reverseAccrualLot(referralLot.id, 'ev_cdr_overbilled', referrerClawback, tx);
      }
    }

    // The double-entry side of the same correction. The original
    // `ev.charging.contribution` posting (partner debited the full pool;
    // bonus liability, an optional referrer-partner, and platform revenue
    // credited their shares) was computed against the original,
    // now-superseded cost — without this, correcting the customer's wallet
    // and the Transaction row still leaves the partner owing the old
    // inflated pool and platform revenue overstated by exactly the
    // clawed-back amount. The ledger would stop reconstructing partner
    // balances from immutable postings, which is the one invariant this
    // accounting system exists to hold (independent audit, GitHub issue #28).
    await this.postEvCorrectionLedgerLegacyIdempotent(tx, {
      partnerId: session.connector.station.partnerId,
      transactionId,
      tutakUpfrontClawback,
      tutakBaseClawback,
      greenClawback,
      deferredClawback,
      referrerClawback,
      referrer,
    });
  }

  /**
   * THREE_LEVEL_V2 program only (2026-08-22 rework) — same proportional
   * `clawbackShare` construction as the legacy method, generalised to up to
   * three referrer legs plus `tutakAmount`, reading every level from the
   * `EvSession`'s own stored snapshot (`referrer1..3Type/UserId/PartnerId/
   * Amount`) — never `ReferralService.resolveReferralChain` again, matching
   * `PurchaseIntentRefundService.reverseLoyaltyEffectsV2`'s identical
   * reasoning: a correction must never re-walk the current chain.
   */
  private async correctOverchargeLegsV2(
    tx: Tx,
    session: {
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
      connector: { station: { partnerId: string } };
    },
    transactionId: string,
    clawbackShare: (granted: Decimal) => Decimal,
  ): Promise<void> {
    const zero = new Decimal(0);
    const greenAmount = session.greenAmount ?? zero;
    const deferredAmount = session.deferredAmount ?? zero;
    const tutakAmount = session.tutakAmount ?? zero;

    const levels: SnapshotLevel[] = [
      {
        level: 1,
        type: session.referrer1Type,
        userId: session.referrer1UserId,
        partnerId: session.referrer1PartnerId,
        amount: clawbackShare(session.referrer1Amount ?? zero),
      },
      {
        level: 2,
        type: session.referrer2Type,
        userId: session.referrer2UserId,
        partnerId: session.referrer2PartnerId,
        amount: clawbackShare(session.referrer2Amount ?? zero),
      },
      {
        level: 3,
        type: session.referrer3Type,
        userId: session.referrer3UserId,
        partnerId: session.referrer3PartnerId,
        amount: clawbackShare(session.referrer3Amount ?? zero),
      },
    ];

    const greenClawback = clawbackShare(greenAmount);
    const deferredClawback = clawbackShare(deferredAmount);
    const tutakClawback = clawbackShare(tutakAmount);

    if (greenClawback.greaterThan(0)) {
      const greenLot = await tx.bonusLot.findFirst({
        where: { sourceTransactionId: transactionId, type: BonusEntryType.ACCRUAL_PURCHASE },
      });
      if (greenLot) {
        await this.bonusEngine.reverseAccrualLot(greenLot.id, 'ev_cdr_overbilled', greenClawback, tx);
      }
    }

    if (deferredClawback.greaterThan(0)) {
      await this.deferredBonusLots.reverseForRefund(transactionId, deferredClawback, 'ev_cdr_overbilled', tx);
    }

    // Per-level clawback — a USER-type level's share lives in its own
    // wallet's `BonusLot` (keyed by walletId, never colliding across
    // levels — see `ReferralService.resolveReferralChain`'s cycle guard); a
    // PARTNER-type level has no wallet lot, so its whole clawback amount
    // reverses directly against their `PARTNER_PAYABLE` in the ledger step.
    for (const lvl of levels) {
      if (lvl.type !== ReferrerType.USER || !lvl.userId || lvl.amount.lessThanOrEqualTo(0)) continue;
      const wallet = await tx.wallet.findUnique({ where: { userId: lvl.userId } });
      const lot = wallet
        ? await tx.bonusLot.findFirst({
            where: { sourceTransactionId: transactionId, type: BonusEntryType.ACCRUAL_REFERRAL, walletId: wallet.id },
          })
        : null;
      if (lot) {
        await this.bonusEngine.reverseAccrualLot(lot.id, 'ev_cdr_overbilled', lvl.amount, tx);
      }
    }

    await this.postEvCorrectionLedgerV2Idempotent(tx, {
      partnerId: session.connector.station.partnerId,
      transactionId,
      greenClawback,
      deferredClawback,
      tutakClawback,
      levels,
    });
  }

  /**
   * LEGACY single-level program only — the ledger side of an overcharge
   * correction: reverses, proportionally, the exact double-entry postings
   * `EvSessionsService`'s legacy `postEvContributionLedgerIdempotent` made
   * for this transaction — partner payable, bonus liability, an optional
   * referrer-partner's own payable, and platform revenue.
   *
   * The five clawback legs the caller passes in were all derived from the
   * same pool split (`tutakUpfront + tutakBase + green + deferred +
   * referrer`), so their sum equals the pool's own clawback exactly, by
   * construction — the posting below balances regardless of any per-leg
   * rounding, the same way the original posting's `tutakBaseOfRemainder`
   * is a residual rather than an independently rounded figure.
   */
  private async postEvCorrectionLedgerLegacyIdempotent(
    tx: Tx,
    amounts: {
      partnerId: string;
      transactionId: string;
      tutakUpfrontClawback: Decimal;
      tutakBaseClawback: Decimal;
      greenClawback: Decimal;
      deferredClawback: Decimal;
      referrerClawback: Decimal;
      referrer: ResolvedReferrer | null;
    },
  ): Promise<void> {
    const poolClawback = amounts.tutakUpfrontClawback
      .plus(amounts.tutakBaseClawback)
      .plus(amounts.greenClawback)
      .plus(amounts.deferredClawback)
      .plus(amounts.referrerClawback);
    if (poolClawback.lessThanOrEqualTo(0)) return;

    const existing = await tx.ledgerTransaction.findFirst({
      where: {
        kind: 'ev.charging.contribution.correction',
        sourceType: 'Transaction',
        sourceId: amounts.transactionId,
      },
      select: { id: true },
    });
    if (existing) return;

    const [partnerAccount, bonusLiabilityAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: amounts.partnerId }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
    ]);

    const customerLiabilityClawback = amounts.greenClawback
      .plus(amounts.deferredClawback)
      .plus(amounts.referrer?.type === 'USER' ? amounts.referrerClawback : 0);
    const tutakRevenueClawback = amounts.tutakUpfrontClawback
      .plus(amounts.tutakBaseClawback)
      .plus(amounts.referrer ? 0 : amounts.referrerClawback);

    const postings = [
      // Reverses the original DEBIT: the partner now owes TuTak less.
      { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: poolClawback },
      ...(customerLiabilityClawback.greaterThan(0)
        ? [
            {
              accountId: bonusLiabilityAccount.id,
              direction: PostingDirection.DEBIT,
              amount: customerLiabilityClawback,
            },
          ]
        : []),
      ...(amounts.referrer?.type === 'PARTNER' && amounts.referrerClawback.greaterThan(0)
        ? [
            {
              accountId: (
                await this.ledger.accountFor(
                  { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: amounts.referrer.partnerId },
                  tx,
                )
              ).id,
              direction: PostingDirection.DEBIT,
              amount: amounts.referrerClawback,
            },
          ]
        : []),
      ...(tutakRevenueClawback.greaterThan(0)
        ? [{ accountId: revenueAccount.id, direction: PostingDirection.DEBIT, amount: tutakRevenueClawback }]
        : []),
    ];

    await this.ledger.post(
      {
        kind: 'ev.charging.contribution.correction',
        sourceType: 'Transaction',
        sourceId: amounts.transactionId,
        postings,
      },
      tx,
    );
  }

  /**
   * THREE_LEVEL_V2 program only — the mirror image of
   * `EvSessionsService.postEvContributionLedgerIdempotent`'s 3-level
   * posting, scaled to this correction's proportional clawback. The six
   * clawback legs (`green`, `deferred`, up to three referrer levels,
   * `tutak`) were all derived from the same `clawbackShare` function
   * applied to the original six-leg split, so their sum equals the pool's
   * own clawback exactly, by construction — the posting below balances
   * regardless of any per-leg rounding, the same residual reasoning
   * `ReferralService.computePoolSplit`'s `tutak` already relies on.
   */
  private async postEvCorrectionLedgerV2Idempotent(
    tx: Tx,
    amounts: {
      partnerId: string;
      transactionId: string;
      greenClawback: Decimal;
      deferredClawback: Decimal;
      tutakClawback: Decimal;
      levels: SnapshotLevel[];
    },
  ): Promise<void> {
    const poolClawback = amounts.greenClawback
      .plus(amounts.deferredClawback)
      .plus(amounts.tutakClawback)
      .plus(amounts.levels.reduce((s, l) => s.plus(l.amount), new Decimal(0)));
    if (poolClawback.lessThanOrEqualTo(0)) return;

    const existing = await tx.ledgerTransaction.findFirst({
      where: {
        kind: 'ev.charging.contribution.correction',
        sourceType: 'Transaction',
        sourceId: amounts.transactionId,
      },
      select: { id: true },
    });
    if (existing) return;

    const [partnerAccount, bonusLiabilityAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: amounts.partnerId }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
    ]);

    const userLevelsClawback = amounts.levels
      .filter((l) => l.type === ReferrerType.USER)
      .reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const customerLiabilityClawback = amounts.greenClawback.plus(amounts.deferredClawback).plus(userLevelsClawback);

    const partnerReferrerPostings = await Promise.all(
      amounts.levels
        .filter((l) => l.type === ReferrerType.PARTNER && l.partnerId && l.amount.greaterThan(0))
        .map(async (l) => {
          const account = await this.ledger.accountFor(
            { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: l.partnerId! },
            tx,
          );
          return { accountId: account.id, direction: PostingDirection.DEBIT, amount: l.amount };
        }),
    );

    const postings = [
      // Reverses the original DEBIT: the partner now owes TuTak less.
      { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: poolClawback },
      ...(customerLiabilityClawback.greaterThan(0)
        ? [{ accountId: bonusLiabilityAccount.id, direction: PostingDirection.DEBIT, amount: customerLiabilityClawback }]
        : []),
      ...partnerReferrerPostings,
      ...(amounts.tutakClawback.greaterThan(0)
        ? [{ accountId: revenueAccount.id, direction: PostingDirection.DEBIT, amount: amounts.tutakClawback }]
        : []),
    ];

    await this.ledger.post(
      {
        kind: 'ev.charging.contribution.correction',
        sourceType: 'Transaction',
        sourceId: amounts.transactionId,
        postings,
      },
      tx,
    );
  }

  private async settle(
    cdrId: string,
    reconciliation: EvCdrReconciliation,
    cpoEnergyKwh: Decimal,
    cpoCost: Decimal,
    remote: { ocpiCdrId: string; totalTimeSec: number; raw: unknown },
    tx?: Tx,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.evCdr.update({
      where: { id: cdrId },
      data: {
        reconciliation,
        cpoEnergyKwh,
        cpoCost,
        reconciledAt: new Date(),
        ocpiCdrId: remote.ocpiCdrId,
        raw: remote.raw as never,
      },
    });
  }

  /** A CDR the operator never produced. */
  private async giveUp(cdrId: string, sessionId: string, attempts: number): Promise<void> {
    await this.prisma.evCdr.update({
      where: { id: cdrId },
      data: { reconciliation: EvCdrReconciliation.UNAVAILABLE, reconciledAt: new Date() },
    });
    this.logger.error(`Operator never produced a CDR for session ${sessionId} after ${attempts} attempts`);
    await this.alerts.fire({
      severity: 'warning',
      key: `ev.cdr.unavailable:${sessionId}`,
      title: 'A charging network never settled a session',
      body:
        `We asked ${attempts} times and the operator has not produced a CDR. The customer was ` +
        'billed on our own reading, which nothing external now corroborates. If this happens ' +
        'for more than the occasional session, the roaming integration is not delivering what ' +
        'it is supposed to and the numbers on that network cannot be defended.',
      context: { sessionId, attempts },
    });
  }
}
