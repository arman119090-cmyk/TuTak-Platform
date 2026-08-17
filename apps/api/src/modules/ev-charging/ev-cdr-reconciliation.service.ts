import { Inject, Injectable, Logger } from '@nestjs/common';
import { EvCdrReconciliation, TransactionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { roundCharge, roundIssued } from '../../common/utils/money';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { OCPI_ADAPTER, OcpiAdapter } from './ocpi/ocpi-adapter.interface';

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
   */
  private async correctOvercharge(
    cdrId: string,
    sessionId: string,
    difference: Decimal,
    cpoEnergy: Decimal,
    cpoCost: Decimal,
    remote: { ocpiCdrId: string; totalTimeSec: number; raw: unknown },
  ): Promise<void> {
    const session = await this.prisma.evSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { transaction: true, connector: { include: { station: true } } },
    });
    const transaction = session.transaction;

    if (transaction && transaction.status === TransactionStatus.COMPLETED) {
      const originalCost = transaction.amount;
      const applied = transaction.bonusAppliedAmount;

      // Points earned on money that was never spent.
      if (transaction.bonusEarnedAmount.greaterThan(0)) {
        const lot = await this.prisma.bonusLot.findFirst({
          where: { sourceTransactionId: transaction.id },
        });
        if (lot) {
          const keep = roundIssued(
            lot.originalAmount.times(cpoCost.minus(Decimal.min(applied, cpoCost))).dividedBy(
              Decimal.max(originalCost.minus(applied), new Decimal(1)),
            ),
          );
          const clawback = Decimal.max(lot.originalAmount.minus(keep), new Decimal(0));
          if (clawback.greaterThan(0)) {
            await this.bonusEngine
              .reverseAccrualLot(lot.id, 'ev_cdr_overbilled', clawback)
              .catch((e) =>
                this.logger.error(`Could not claw back over-accrued points on ${lot.id}`, e),
              );
          }
        }
      }

      // Points spent on a bill that turned out to be smaller than the hold.
      if (applied.greaterThan(cpoCost)) {
        const excess = applied.minus(cpoCost);
        const wallet = await this.prisma.wallet.findUnique({ where: { userId: session.userId } });
        if (wallet) {
          await this.bonusEngine
            .accrue({
              walletId: wallet.id,
              type: 'ACCRUAL_MANUAL_ADJUSTMENT',
              amount: excess,
              pendingHours: 0,
              sourceTransactionId: transaction.id,
              metadata: { reason: 'ev_cdr_overbilled', sessionId },
            })
            .catch((e) => this.logger.error('Could not return over-applied points', e));
        }
      }

      await this.prisma.transaction.update({
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

    await this.settle(cdrId, EvCdrReconciliation.CORRECTED, cpoEnergy, cpoCost, remote);

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

  private async settle(
    cdrId: string,
    reconciliation: EvCdrReconciliation,
    cpoEnergyKwh: Decimal,
    cpoCost: Decimal,
    remote: { ocpiCdrId: string; totalTimeSec: number; raw: unknown },
  ): Promise<void> {
    await this.prisma.evCdr.update({
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
