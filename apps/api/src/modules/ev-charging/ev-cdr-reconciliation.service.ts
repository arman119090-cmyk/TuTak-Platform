import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BonusEntryType,
  EvCdrReconciliation,
  EvSessionStatus,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  ReferralProgramVersion,
  ReferrerType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { roundCharge, roundIssued } from '../../common/utils/money';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import {
  CURRENT_REFERRAL_PROGRAM_VERSION,
  ReferralChainLevel,
  ReferralService,
  ResolvedReferrer,
} from '../referral/referral.service';
import { LedgerService } from '../ledger/ledger.service';
import { TransactionsService } from '../transactions/transactions.service';
import { FraudDetectionService } from '../security/fraud-detection.service';
import { PhoneVerificationService } from '../auth/phone-verification.service';
import { PartnersService } from '../partners/partners.service';
import { RoamingCpoSettlementService } from '../roaming-cpo/roaming-cpo-settlement.service';
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
    private readonly transactionsService: TransactionsService,
    private readonly fraudDetection: FraudDetectionService,
    private readonly phoneVerification: PhoneVerificationService,
    private readonly partners: PartnersService,
  ) {}

  /**
   * Polls every roaming CDR still waiting on its operator, and — separately —
   * every app-initiated `ROAMING_CPO` session still `AWAITING_SETTLEMENT`
   * (docs/ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md). The two are
   * deliberately different queries: a `PENDING` `EvCdr` is a session already
   * billed, here to be corrected against the operator's figure; an
   * `AWAITING_SETTLEMENT` session has never been billed at all — it is
   * billed for the first time the moment its CDR arrives. Sharing one sweep
   * (`ev.reconcile-roaming-cdrs`) rather than adding a second job reuses the
   * existing lock, heartbeat and alerting for free.
   */
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

    const awaitingSettlement = await this.prisma.evSession.findMany({
      where: { status: EvSessionStatus.AWAITING_SETTLEMENT, settlementGivenUpAt: null },
      orderBy: { stoppedAt: 'asc' },
      take: 200,
    });

    for (const session of awaitingSettlement) {
      try {
        if (await this.completeAppInitiatedSession(session.id)) settled += 1;
      } catch (err) {
        this.logger.error(
          `Could not complete roaming session ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (settled > 0) this.logger.log(`Reconciled ${settled} roaming CDR(s)/session(s)`);
    return settled;
  }

  /**
   * Bills an app-initiated `ROAMING_CPO` session for the first time, once
   * the CPO's own trusted CDR finally answers — see
   * docs/ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md and the
   * `AWAITING_SETTLEMENT` status docblock. Mirrors `reconcileOne`'s own
   * claim/fetch/give-up shape exactly (same constants, same reasoning), but
   * completes a bill rather than correcting one: there is no existing
   * `Transaction`/`EvCdr` row to update, because none was ever created —
   * this is the first and only place either is created for this session.
   *
   * Returns true when the session reached a terminal state on this pass
   * (billed, or given up on after `MAX_FETCH_ATTEMPTS`); false when the CPO
   * simply has not answered yet.
   */
  private async completeAppInitiatedSession(sessionId: string): Promise<boolean> {
    const staleBefore = new Date(Date.now() - RECONCILE_CLAIM_STALE_AFTER_MS);
    const claimed = await this.prisma.evSession.updateMany({
      where: {
        id: sessionId,
        status: EvSessionStatus.AWAITING_SETTLEMENT,
        OR: [{ settlingAt: null }, { settlingAt: { lt: staleBefore } }],
      },
      data: { settlingAt: new Date() },
    });
    if (claimed.count === 0) return false;

    const session = await this.prisma.evSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { connector: { include: { station: { include: { partner: true } } } } },
    });

    const remoteId = session.ocpiCdrId ?? session.id;
    const remote = await this.ocpiAdapter.fetchCdr(remoteId);

    if (!remote) {
      const attempts = session.settlementAttempts + 1;
      await this.prisma.evSession.update({
        where: { id: session.id },
        data: { settlementAttempts: attempts, settlingAt: null },
      });
      if (attempts >= MAX_FETCH_ATTEMPTS) {
        await this.prisma.evSession.update({
          where: { id: session.id },
          data: { settlementGivenUpAt: new Date() },
        });
        this.logger.error(
          `Operator never produced a CDR for roaming session ${session.id} after ${attempts} attempts`,
        );
        await this.alerts.fire({
          severity: 'critical',
          key: `ev.roaming.settlement_unavailable:${session.id}`,
          title: 'A roaming-CPO charge could not be billed',
          body:
            `We asked ${attempts} times and the operator has not produced a CDR for a session a ` +
            'customer already drove away from. Real energy was very likely delivered and TuTak ' +
            'has no trustworthy figure to bill it at — this needs a person, not another retry.',
          context: { sessionId: session.id, attempts },
        });
        return true;
      }
      return false;
    }

    // Frozen at `start()` — never re-read from the live `EvStation`/`Partner`
    // rows, so a later change to either never alters a session already in
    // flight. `start()` refuses to open a `ROAMING_CPO` session at all when
    // `standardRetailRatePerKwh` is null, so these are guaranteed non-null
    // here.
    const retailRate = session.stationRetailRatePerKwh!;
    const wholesaleRate = session.wholesaleRatePerKwh!;
    const marginCap = session.marginReferralCapPerKwh!;

    const energyKwh = new Decimal(remote.totalEnergyKwh).toDecimalPlaces(3);
    const cost = roundCharge(energyKwh.times(retailRate));
    const wholesaleAmount = roundCharge(energyKwh.times(wholesaleRate));
    const { pool, uncappedRevenue } = RoamingCpoSettlementService.computeMargin({
      appliedCustomerRatePerKwh: retailRate,
      wholesaleRatePerKwh: wholesaleRate,
      marginReferralCapPerKwh: marginCap,
      energyKwh,
    });

    const partnerId = session.connector.station.partnerId;
    const transaction = await this.transactionsService.create({
      userId: session.userId,
      partnerId,
      type: TransactionType.EV_CHARGING,
      amount: cost,
      bonusAppliedAmount: new Decimal(0),
      description: `EV charging at ${session.connector.station.name}`,
      metadata: { sessionId: session.id, energyKwh: energyKwh.toString(), roaming: true },
    });

    // Same velocity check every other EV/QR settlement path runs. Unlike
    // the interactive `stopOnce`, there is no live request to hold for
    // review here — the physical charge already happened minutes to hours
    // ago — so an anomalous result is flagged for a human on the completed
    // transaction rather than blocking completion of a session nothing can
    // undo.
    const anomalous = await this.fraudDetection
      .checkVelocity(session.userId, transaction.id)
      .catch((e) => {
        this.logger.error('Fraud velocity check failed', e);
        return false;
      });
    if (anomalous) {
      await this.transactionsService.markFlagged(transaction.id, 'velocity_limit_exceeded');
    }

    try {
      // Business decision (2026-08-16, M7 revision), applied here exactly as
      // `EvSessionsService.stopOnce` applies it to the internal path: an
      // affiliated partner owner/staff may charge at their own station —
      // nothing earlier in this flow blocked the session — but the session
      // must grant them no bonus benefit. Unlike the internal path (which
      // skips its whole commission pool when ineligible), this mirrors the
      // *walk-in* roaming settlement's own `eligible` fallback: TuTak's
      // margin is never gated on the customer's eligibility, only the
      // customer-facing bonus split is — an ineligible session still owes
      // the partner the same wholesale amount and still earns TuTak the
      // same margin, it simply keeps the whole pool as revenue instead of
      // splitting it.
      const canEarn = await this.phoneVerification
        .assertCanEarn(session.userId)
        .then(() => true)
        .catch(() => false);
      const affiliated = await this.partners.isAffiliated(partnerId, session.userId);
      const eligible = canEarn && !affiliated && pool.greaterThan(0);

      let chain: ReferralChainLevel[] = [];
      let green = new Decimal(0);
      let deferred = new Decimal(0);
      let l1 = new Decimal(0);
      let l2 = new Decimal(0);
      let l3 = new Decimal(0);
      let tutak = pool;
      if (eligible) {
        chain = await this.referralService.resolveReferralChain(session.userId);
        const split = this.referralService.computePoolSplit(pool, chain);
        green = split.green;
        deferred = split.deferred;
        l1 = split.l1;
        l2 = split.l2;
        l3 = split.l3;
        tutak = split.tutak;
      }
      const l1Entry = chain.find((c) => c.level === 1) ?? null;
      const l2Entry = chain.find((c) => c.level === 2) ?? null;
      const l3Entry = chain.find((c) => c.level === 3) ?? null;

      await this.prisma.$transaction(async (tx) => {
        await tx.evSession.update({
          where: { id: session.id },
          data: {
            status: EvSessionStatus.COMPLETED,
            energyKwh,
            cost,
            transactionId: transaction.id,
            appliedCustomerRatePerKwh: retailRate,
            marginPerKwh: Decimal.max(retailRate.minus(wholesaleRate), 0),
            uncappedMarginRevenueAmount: uncappedRevenue,
            poolAmount: pool,
            greenAmount: green,
            deferredAmount: deferred,
            programVersion: eligible ? CURRENT_REFERRAL_PROGRAM_VERSION : null,
            referrer1Type: l1Entry?.type ?? null,
            referrer1UserId: l1Entry?.type === 'USER' ? l1Entry.userId : null,
            referrer1PartnerId: l1Entry?.type === 'PARTNER' ? l1Entry.partnerId : null,
            referrer1Amount: l1,
            referrer2Type: l2Entry?.type ?? null,
            referrer2UserId: l2Entry?.type === 'USER' ? l2Entry.userId : null,
            referrer2PartnerId: l2Entry?.type === 'PARTNER' ? l2Entry.partnerId : null,
            referrer2Amount: l2,
            referrer3Type: l3Entry?.type ?? null,
            referrer3UserId: l3Entry?.type === 'USER' ? l3Entry.userId : null,
            referrer3PartnerId: l3Entry?.type === 'PARTNER' ? l3Entry.partnerId : null,
            referrer3Amount: l3,
            tutakAmount: tutak,
          },
        });

        await tx.evCdr.create({
          data: {
            sessionId: session.id,
            totalEnergy: energyKwh,
            totalCost: cost,
            totalTimeSec: remote.totalTimeSec,
            reconciliation: EvCdrReconciliation.NOT_APPLICABLE,
            ocpiCdrId: remote.ocpiCdrId,
            raw: remote.raw as never,
          },
        });

        if (green.greaterThan(0)) {
          const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: session.userId } });
          await this.bonusEngine.accrue(
            {
              walletId: wallet.id,
              type: BonusEntryType.ACCRUAL_PURCHASE,
              amount: green,
              sourceTransactionId: transaction.id,
            },
            tx,
          );
        }

        await this.deferredBonusLots.advanceExistingLots(session.userId, cost, transaction.id, tx);
        if (deferred.greaterThan(0)) {
          await this.deferredBonusLots.createLot(session.userId, deferred, transaction.id, tx);
        }
        await this.referralService.creditChainShares(chain, { l1, l2, l3 }, transaction.id, tx);

        await this.postEvRoamingSettlementLedgerIdempotent(
          tx,
          partnerId,
          { wholesaleAmount, green, deferred, l1, l2, l3, tutak, uncappedRevenue, chain },
          transaction.id,
        );

        await this.transactionsService.markCompleted(transaction.id, { bonusEarnedAmount: green }, tx);
      });

      return true;
    } catch (err) {
      // Nothing was committed — the atomic transaction above rolled
      // everything back together, including the session's own status
      // change. Release the claim (without counting it as a failed fetch
      // attempt — the CPO answered fine, this was an internal error) so the
      // next pass retries with a fresh `fetchCdr` call.
      this.logger.error(
        `Failed to complete roaming session ${session.id}, will retry next pass: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.transactionsService
        .markFailed(transaction.id, err instanceof Error ? err.message : 'unknown_error')
        .catch(() => undefined);
      await this.prisma.evSession
        .update({ where: { id: session.id }, data: { settlingAt: null } })
        .catch(() => undefined);
      throw err;
    }
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
  private async postEvRoamingSettlementLedgerIdempotent(
    tx: Tx,
    partnerId: string,
    amounts: {
      wholesaleAmount: Decimal;
      green: Decimal;
      deferred: Decimal;
      l1: Decimal;
      l2: Decimal;
      l3: Decimal;
      tutak: Decimal;
      uncappedRevenue: Decimal;
      chain: ReferralChainLevel[];
    },
    transactionId: string,
  ): Promise<void> {
    const existing = await tx.ledgerTransaction.findFirst({
      where: { kind: 'ev.roaming.app_settlement', sourceType: 'Transaction', sourceId: transactionId },
      select: { id: true },
    });
    if (existing) return;

    const [partnerAccount, bonusLiabilityAccount, revenueAccount, receivableAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
      this.ledger.accountFor({ type: LedgerAccountType.EV_ROAMING_RECEIVABLE }, tx),
    ]);

    const byLevel: Record<1 | 2 | 3, Decimal> = { 1: amounts.l1, 2: amounts.l2, 3: amounts.l3 };
    const userLiability = amounts.chain
      .filter((c) => c.type === 'USER')
      .reduce((sum, c) => sum.plus(byLevel[c.level]), new Decimal(0));
    const customerLiability = amounts.green.plus(amounts.deferred).plus(userLiability);

    const partnerReferrerPostings = await Promise.all(
      amounts.chain
        .filter((c): c is ReferralChainLevel & { type: 'PARTNER' } => c.type === 'PARTNER')
        .map(async (c) => {
          const share = byLevel[c.level];
          if (share.lessThanOrEqualTo(0)) return null;
          const account = await this.ledger.accountFor(
            { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: c.partnerId },
            tx,
          );
          return { accountId: account.id, direction: PostingDirection.CREDIT, amount: share };
        }),
    );

    const revenueCredit = amounts.tutak.plus(amounts.uncappedRevenue);

    // Unlike `postEvContributionLedgerIdempotent` (the internal/commission
    // model, where the customer pays the partner directly and the partner's
    // own contribution funds TuTak's economics — so the partner account is
    // DEBITED), this is the one purchase path in the platform where TuTak
    // itself is the party the customer owes money to: TuTak buys the energy
    // wholesale and resells it at retail. So the partner account is
    // CREDITED (TuTak now genuinely owes them the wholesale amount for
    // energy delivered), and the debit lands on `EV_ROAMING_RECEIVABLE` —
    // see that account type's own docblock for why collecting it is a
    // separate, not-yet-built concern this posting does not try to solve.
    // The debit is the sum of every credit below, by construction, so this
    // balances regardless of whether it equals `cost` exactly (the same
    // "residual, not independently rounded" discipline `computePoolSplit`'s
    // own `tutak` leg already relies on).
    const postings = [
      { accountId: partnerAccount.id, direction: PostingDirection.CREDIT, amount: amounts.wholesaleAmount },
      ...(customerLiability.greaterThan(0)
        ? [{ accountId: bonusLiabilityAccount.id, direction: PostingDirection.CREDIT, amount: customerLiability }]
        : []),
      ...partnerReferrerPostings.filter((p): p is NonNullable<typeof p> => p !== null),
      ...(revenueCredit.greaterThan(0)
        ? [{ accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: revenueCredit }]
        : []),
    ];
    const totalCredit = postings.reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
    if (totalCredit.lessThanOrEqualTo(0)) return;

    await this.ledger.post(
      {
        kind: 'ev.roaming.app_settlement',
        sourceType: 'Transaction',
        sourceId: transactionId,
        postings: [
          { accountId: receivableAccount.id, direction: PostingDirection.DEBIT, amount: totalCredit },
          ...postings,
        ],
      },
      tx,
    );
  }

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
