import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BonusEntryType,
  EvCdrReconciliation,
  EvConnectorStatus,
  EvReservationStatus,
  EvSessionStatus,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseMoney, roundCharge, roundIssued } from '../../common/utils/money';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionsService } from '../transactions/transactions.service';
import { FraudDetectionService } from '../security/fraud-detection.service';
import { PhoneVerificationService } from '../auth/phone-verification.service';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../ledger/outbox.service';
import { PartnersService } from '../partners/partners.service';
import { MediaViewService } from '../media/media-view.service';
import {
  CURRENT_REFERRAL_PROGRAM_VERSION,
  ReferralChainLevel,
  ReferralService,
} from '../referral/referral.service';
import { OCPI_ADAPTER, OcpiAdapter } from './ocpi/ocpi-adapter.interface';
import { StartSessionDto, StopSessionDto } from './dto/start-session.dto';

type Tx = Prisma.TransactionClient;

/**
 * How far above the connector's nameplate rating a reading may sit before it
 * is rejected. Real meters drift, clocks skew, and a session's `startedAt` is
 * recorded a moment after energy begins to flow, so a hard equality would
 * reject honest readings. 15% plus a 1 kWh floor absorbs that without leaving
 * room for a meaningful overstatement.
 */
const METER_TOLERANCE = new Decimal('1.15');
const METER_FLOOR_KWH = new Decimal('1');

/** `EvSession.energyKwh` is Decimal(10,3) — anything finer would be rounded away. */
const ENERGY_SCALE = 3;

/**
 * Longest window a session may bill for, and the age at which an abandoned
 * one is swept.
 *
 * Bounding a reading by the connector's rating fixed the magnitude of a
 * fraudulent claim but not its window: the ceiling is proportional to elapsed
 * time, and nothing closed a session that was simply never stopped. One left
 * open for a month billed 36,000 kWh and paid 180,000 points, and the bay
 * stayed CHARGING for as long as the row existed. Capping the billable window
 * bounds the money; the sweep bounds the stuck state.
 */
const MAX_BILLABLE_HOURS = new Decimal(24);
const STALE_SESSION_HOURS = 24;

/** JSON-safe wire shape of one `ReferralChainLevel`, for the outbox payload — plain strings only. */
type SerializedChainLevel =
  | { level: 1 | 2 | 3; type: 'USER'; userId: string }
  | { level: 1 | 2 | 3; type: 'PARTNER'; partnerId: string };

function serializeChainLevel(entry: ReferralChainLevel): SerializedChainLevel {
  return entry.type === 'USER'
    ? { level: entry.level, type: 'USER', userId: entry.userId }
    : { level: entry.level, type: 'PARTNER', partnerId: entry.partnerId };
}

function deserializeChainLevel(entry: SerializedChainLevel): ReferralChainLevel {
  return entry.type === 'USER'
    ? { level: entry.level, type: 'USER', userId: entry.userId }
    : { level: entry.level, type: 'PARTNER', partnerId: entry.partnerId };
}

function parseEnergyKwh(value: string): Decimal {
  const reading = parseMoney(value, 'energyKwh');
  if (reading.decimalPlaces() > ENERGY_SCALE) {
    throw new BadRequestException(`energyKwh supports at most ${ENERGY_SCALE} decimal places`);
  }
  return reading;
}

/**
 * Rejects an energy reading larger than the connector could have produced.
 *
 * This is the ceiling on how much bonus a single session can mint: a 50 kW
 * connector running for an hour tops out around 57 kWh, so the accrual is
 * bounded by physics rather than by whatever the client claims.
 */
function assertDeliverable(reading: Decimal, powerKw: Decimal, startedAt: Date | null) {
  const elapsedHours = startedAt
    ? new Decimal(Math.max(0, Date.now() - startedAt.getTime())).dividedBy(3_600_000)
    : new Decimal(0);

  // A session's age is not a licence to bill for it. Beyond the cap the
  // session is abandoned, not charging, and the sweep will close it.
  const billableHours = Decimal.min(elapsedHours, MAX_BILLABLE_HOURS);

  const ceiling = Decimal.max(powerKw.times(billableHours).times(METER_TOLERANCE), METER_FLOOR_KWH);

  if (reading.greaterThan(ceiling)) {
    throw new BadRequestException(
      `Meter reading of ${reading.toString()} kWh exceeds what the connector could have delivered ` +
        `(${powerKw.toString()} kW for ${billableHours.toFixed(3)} h)`,
    );
  }
}

@Injectable()
export class EvSessionsService {
  private readonly logger = new Logger(EvSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly walletService: WalletService,
    private readonly transactionsService: TransactionsService,
    private readonly fraudDetection: FraudDetectionService,
    private readonly phoneVerification: PhoneVerificationService,
    @Inject(OCPI_ADAPTER) private readonly ocpiAdapter: OcpiAdapter,
    private readonly alerts: AlertsService,
    private readonly idempotency: IdempotencyService,
    private readonly partners: PartnersService,
    private readonly referralService: ReferralService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly media: MediaViewService,
  ) {
    // Guaranteed-retry backstop for `postEvContributionLedgerIdempotent`'s
    // fast path below: `outbox.drain()` (the `outbox.drain` sweep) replays
    // this until the entry exists, so a transient failure on the fast path
    // is a delay, never a permanently missing posting. See the settlement
    // block in `stopOnce` for why the event is published atomically with
    // the wallet-side effects it accounts for.
    this.outbox.register('ev.contribution.ledger_post', async (payload) => {
      const chain = (payload.chain as SerializedChainLevel[] | undefined) ?? [];

      await this.postEvContributionLedgerIdempotent(
        payload.partnerId as string,
        {
          pool: new Decimal(payload.pool as string),
          green: new Decimal(payload.green as string),
          deferred: new Decimal(payload.deferred as string),
          l1: new Decimal(payload.l1 as string),
          l2: new Decimal(payload.l2 as string),
          l3: new Decimal(payload.l3 as string),
          tutak: new Decimal(payload.tutak as string),
          chain: chain.map(deserializeChainLevel),
        },
        payload.transactionId as string,
      );
    });
  }

  async start(dto: StartSessionDto, userId: string) {
    const connector = await this.prisma.evConnector.findUnique({
      where: { id: dto.connectorId },
      include: { station: { include: { partner: true } } },
    });
    if (!connector) throw new NotFoundException('Connector not found');
    if (!connector.station.partner.isActive) {
      throw new BadRequestException('This charging network is not currently active');
    }
    // Business decision (2026-08-16, M7 revision): unlike QR, PurchaseIntent
    // and Payments capture, a partner's own owner/staff MAY charge at their
    // own affiliated station — the session itself is not blocked. What they
    // must not do is earn a TuTak bonus benefit from it; that guard lives in
    // stopOnce(), around the bonus-accrual computation, not here.

    if (dto.reservationId) {
      const reservation = await this.prisma.evReservation.findUnique({ where: { id: dto.reservationId } });
      if (!reservation || reservation.userId !== userId || reservation.connectorId !== dto.connectorId) {
        throw new BadRequestException('Reservation does not match this user/connector');
      }
      if (reservation.status !== EvReservationStatus.CONFIRMED) {
        throw new BadRequestException('Reservation is not confirmed');
      }
    } else if (connector.status !== EvConnectorStatus.AVAILABLE) {
      throw new BadRequestException('Connector is not available');
    }

    return this.prisma.$transaction(async (tx) => {
      // Claim the bay conditionally rather than asserting it is free and then
      // taking it. The check above reads the connector outside this
      // transaction, so two customers tapping "start" on the same charger at
      // the same moment both passed it and both got a session — two people
      // billed for one cable. Whoever moves the status out of AVAILABLE first
      // owns the bay; the loser is refused. Same shape as the QR code flip,
      // which is correct for the same reason.
      //
      // A confirmed reservation may claim a connector held in RESERVED for
      // it, which is the whole point of reserving one.
      const claimable = dto.reservationId
        ? [EvConnectorStatus.AVAILABLE, EvConnectorStatus.RESERVED]
        : [EvConnectorStatus.AVAILABLE];

      const claimed = await tx.evConnector.updateMany({
        where: { id: connector.id, status: { in: claimable } },
        data: { status: EvConnectorStatus.CHARGING },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Connector is not available');
      }

      const session = await tx.evSession.create({
        data: {
          connectorId: connector.id,
          userId,
          reservationId: dto.reservationId,
          status: EvSessionStatus.CHARGING,
          startedAt: new Date(),
          energyKwh: 0,
        },
        // Joined so the response is a session a client can render on its own.
        // Without it the app opens its charging screen with no price and no
        // station name and has to wait a poll cycle to fill them in — the
        // same shape `historyForUser` already returns.
        include: { connector: { include: { station: true } } },
      });

      if (dto.reservationId) {
        await tx.evReservation.update({
          where: { id: dto.reservationId },
          data: { status: EvReservationStatus.FULFILLED },
        });
      }

      if (connector.ocpiEvseUid) {
        const result = await this.ocpiAdapter.startRemoteSession({
          ocpiEvseUid: connector.ocpiEvseUid,
          userId,
          localSessionId: session.id,
        });
        if (!result.accepted) {
          throw new BadRequestException('Roaming CPO rejected the remote start command');
        }

        // Keep the identifier the CPO answered with. It was being discarded,
        // and `stop()` then addressed the remote session by *our* id — an
        // identifier the CPO has never seen, so the stop command would not
        // match anything on their side and the bay would keep delivering
        // energy. Only reachable on a roaming connector, of which there are
        // none yet; see docs/AUDIT_FINANCIAL_2026-08.md on what else the
        // roaming path still needs before it can carry money.
        if (result.ocpiSessionId) {
          await tx.evSession.update({
            where: { id: session.id },
            data: { ocpiCdrId: result.ocpiSessionId },
          });
          session.ocpiCdrId = result.ocpiSessionId;
        }
      }

      return session;
    });
  }

  /**
   * OCPP-style meter value ingestion.
   *
   * The energy reported here is the entire basis of the bill and of the bonus
   * accrued on it, so it is the most security-sensitive input in the module.
   * Until a charge point authenticates in its own right, two guards stand in:
   * the caller must own the session (or operate the station), and the reading
   * must be physically possible for the connector over the elapsed time.
   *
   * Without them any customer could declare 9,999,999 kWh and collect the
   * partner's accrual rate on a billion AMD — see docs/AUDIT_2026-08-B.md §C1.
   *
   * @param callerUserId  the customer whose session this must be, or null when
   *                      an operator is reporting on a charge point's behalf.
   * @param operator      partner scope of an EV_STATION_MANAGE holder.
   */
  async reportMeterValue(
    sessionId: string,
    energyKwh: string,
    callerUserId: string | null,
    operator?: { partnerId: string },
  ) {
    const reading = parseEnergyKwh(energyKwh);

    const session = await this.prisma.evSession.findUnique({
      where: { id: sessionId },
      include: { connector: { include: { station: true } } },
    });

    // A caller who does not own the session learns nothing about whether it
    // exists — the id alone must not be authority over someone else's bill.
    if (!session || (callerUserId !== null && session.userId !== callerUserId)) {
      throw new NotFoundException('Session not found');
    }
    if (operator && session.connector.station.partnerId !== operator.partnerId) {
      throw new ForbiddenException('This session belongs to another partner');
    }
    if (session.status !== EvSessionStatus.CHARGING) {
      throw new BadRequestException('Session is not currently charging');
    }

    // A meter is monotonic: energy delivered can only increase within a
    // session. Accepting a lower reading would let a caller reduce the bill
    // after the fact.
    if (session.energyKwh && reading.lessThan(session.energyKwh)) {
      throw new BadRequestException('Meter reading cannot decrease');
    }

    assertDeliverable(reading, session.connector.powerKw, session.startedAt);

    return this.prisma.evSession.update({
      where: { id: sessionId },
      data: { energyKwh: reading },
    });
  }

  /**
   * Stops a session, at most once per idempotency key.
   *
   * The claim inside `stopOnce` already makes two simultaneous stops safe.
   * What it cannot do is tell a client whose request timed out *while the
   * server was working* whether the charge went through: a retry gets
   * "already being stopped", which is indistinguishable from a genuine
   * error. A key turns that retry into the original answer.
   *
   * Optional, because the shipped mobile app does not send one and making it
   * mandatory would break every installed copy. Without a key the behaviour
   * is exactly what it was.
   */
  async stop(sessionId: string, userId: string, dto: StopSessionDto) {
    if (!dto.idempotencyKey) {
      return this.stopOnce(sessionId, userId, dto);
    }
    return this.idempotency.run(
      {
        // Scoped to the caller: a bare key would let one account replay
        // another's stop and receive their session's figures.
        scope: `ev-stop:${userId}`,
        key: dto.idempotencyKey,
        request: { sessionId, bonusAmountToApply: dto.bonusAmountToApply ?? null },
      },
      () => this.stopOnce(sessionId, userId, dto),
    );
  }

  private async stopOnce(sessionId: string, userId: string, dto: StopSessionDto) {
    const session = await this.prisma.evSession.findUnique({
      where: { id: sessionId },
      include: { connector: { include: { station: true } } },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Charging session not found');
    }
    if (session.status !== EvSessionStatus.CHARGING) {
      throw new BadRequestException(`Session cannot be stopped (status: ${session.status})`);
    }

    // Claim the stop before doing anything that costs money.
    //
    // The check above is a read outside any transaction, so two stops in
    // flight together — a double tap, or a client retrying a request that
    // timed out while the server was still working — both passed it. Both
    // then created a transaction, reserved and settled the customer's points,
    // and told the charger to stop. The second one only failed at the very
    // end, on the CDR's unique index, by which time it had already spent
    // points and issued a second remote stop; its cleanup then marked a
    // session that had billed correctly as INVALID.
    //
    // Stamping `stoppedAt` is the claim: it is the one column that is null
    // exactly while a session is stoppable, so whoever sets it owns the stop.
    // A process that dies between here and the billing transaction leaves the
    // session CHARGING with a stop time, which `expireStaleSessions` closes.
    const claimed = await this.prisma.evSession.updateMany({
      where: { id: sessionId, status: EvSessionStatus.CHARGING, stoppedAt: null },
      data: { stoppedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('Session is already being stopped');
    }

    const energyKwh = session.energyKwh ?? new Decimal(0);

    // Re-checked here on purpose. reportMeterValue is not the only way a row
    // can acquire an energy reading — a future OCPI adapter, an operator
    // script or a bug could write one directly — and this is the moment the
    // number becomes money. Settlement is the right place for the last word.
    try {
      assertDeliverable(energyKwh, session.connector.powerKw, session.startedAt);
    } catch (err) {
      // The reading is rejected, but the bay must not be left occupied.
      await this.releaseConnector(session.connectorId, session.id).catch((e) =>
        this.logger.error(`Failed to free connector ${session.connectorId}`, e),
      );
      throw err;
    }

    // Rounded because the product is not storable as-is: a 3-decimal meter
    // reading times a 2-decimal tariff is 5 decimals, and the amount column
    // holds 4. Unrounded, `parseMoney` refused it and the session could not
    // be stopped at all.
    const cost = roundCharge(energyKwh.times(session.connector.pricePerKwh));
    // Same negative-amount hole as the QR path: a negative bonus turned
    // `cost.minus(bonus)` into an addition and inflated the accrual base.
    const bonusToApply = dto.bonusAmountToApply
      ? parseMoney(dto.bonusAmountToApply, 'bonusAmountToApply')
      : new Decimal(0);
    if (bonusToApply.greaterThan(cost)) {
      throw new BadRequestException('Bonus applied cannot exceed the session cost');
    }

    const transaction = await this.transactionsService.create({
      userId,
      partnerId: session.connector.station.partnerId,
      type: TransactionType.EV_CHARGING,
      amount: cost,
      bonusAppliedAmount: bonusToApply,
      description: `EV charging at ${session.connector.station.name}`,
      metadata: { sessionId: session.id, energyKwh: energyKwh.toString() },
    });

    const anomalous = await this.fraudDetection
      .checkVelocity(userId, transaction.id)
      .catch((e) => {
        this.logger.error('Fraud velocity check failed', e);
        return false;
      });
    if (anomalous) {
      await this.transactionsService.markFlagged(transaction.id, 'velocity_limit_exceeded');
      await this.releaseConnector(session.connectorId, session.id).catch((e) =>
        this.logger.error(`Failed to free connector ${session.connectorId}`, e),
      );
      throw new BadRequestException('This session was held for review. Please contact support.');
    }

    let reservationId: string | null = null;
    let accruedLotId: string | null = null;
    try {
      if (bonusToApply.greaterThan(0)) {
        const walletId = await this.walletService.getWalletIdForUser(userId);
        const reservation = await this.bonusEngine.reserve(walletId, bonusToApply, transaction.id);
        reservationId = reservation.reservationId;
        await this.bonusEngine.settleReservation(reservationId);
      }

      if (session.connector.ocpiEvseUid) {
        await this.ocpiAdapter.stopRemoteSession({ ocpiSessionId: session.ocpiCdrId ?? session.id });
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.evConnector.update({
          where: { id: session.connectorId },
          data: { status: EvConnectorStatus.AVAILABLE },
        });
        await tx.evSession.update({
          where: { id: session.id },
          data: {
            status: EvSessionStatus.COMPLETED,
            stoppedAt: new Date(),
            energyKwh,
            cost,
            transactionId: transaction.id,
          },
        });
        await tx.evCdr.create({
          data: {
            sessionId: session.id,
            totalEnergy: energyKwh,
            totalCost: cost,
            totalTimeSec: session.startedAt
              ? Math.max(0, Math.round((Date.now() - session.startedAt.getTime()) / 1000))
              : 0,
            // On our own stations there is one meter and it is ours, so there
            // is nothing to reconcile. On a roaming station the operator owns
            // the cable and their settled CDR is the authoritative record of
            // what was delivered — it arrives minutes to hours later, so the
            // session is marked as awaiting it and
            // `ev.reconcile-roaming-cdrs` picks it up.
            reconciliation: session.connector.ocpiEvseUid
              ? EvCdrReconciliation.PENDING
              : EvCdrReconciliation.NOT_APPLICABLE,
          },
        });
      });

      let green = new Decimal(0);
      let completed: Awaited<ReturnType<TransactionsService['markCompleted']>> | undefined;
      const rateBps = session.connector.station.partnerId
        ? (await this.prisma.partner.findUnique({ where: { id: session.connector.station.partnerId } }))
            ?.bonusAccrualRateBps
        : undefined;
      const canEarn = await this.phoneVerification
        .assertCanEarn(userId)
        .then(() => true)
        .catch(() => false);
      // Business decision (2026-08-16, M7 revision): an affiliated partner
      // owner/staff may charge at their own station — start() does not
      // block the session — but must receive no TuTak benefit from it. This
      // is the one guard that enforces that: it suppresses earning only,
      // the same way `canEarn` already suppresses it for an unverified
      // phone. `bonusToApply` (spending bonus the customer already earned
      // elsewhere) is untouched — that is not a benefit this session grants,
      // and the instruction was explicitly not to block the session itself.
      const affiliated = session.connector.station.partnerId
        ? await this.partners.isAffiliated(session.connector.station.partnerId, userId)
        : false;
      if (rateBps && canEarn && !affiliated) {
        const paidPortion = cost.minus(bonusToApply);
        // Business decision (2026-08-22, 3-level referral rework):
        // FastCharge's whole commission pool splits directly by the same
        // six-leg rule a confirmed PurchaseIntent uses — no separate
        // upfront TuTak cut layered on top (requirement 4: a duplicate
        // TuTak cut on the EV pool, on top of the six-leg split, is
        // explicitly forbidden). `pool` is the paid-portion commission this
        // connector's partner rate produces, unchanged from before; what
        // changed is that it is no longer cut once for TuTak and then split
        // again — see `ReferralService.computePoolSplit`, which this calls
        // and only this, exactly as `PurchaseIntentsService.settlePurchase`
        // does.
        const pool = roundIssued(paidPortion.times(rateBps).dividedBy(10_000));
        const chain = await this.referralService.resolveReferralChain(userId);
        const split = this.referralService.computePoolSplit(pool, chain);
        green = split.green;
        const deferred = split.deferred;
        const { l1, l2, l3, tutak } = split;
        const l1Entry = chain.find((c) => c.level === 1) ?? null;
        const l2Entry = chain.find((c) => c.level === 2) ?? null;
        const l3Entry = chain.find((c) => c.level === 3) ?? null;

        const walletId = await this.walletService.getWalletIdForUser(userId);
        const partnerId = session.connector.station.partnerId;

        // The wallet-side effects and the durable promise to post their
        // accounting entry commit atomically: a wallet credit must never
        // exist with nothing at all recording that the ledger still owes
        // it (GitHub issue #28, HEAD 0a9c7d5). The posting itself is
        // attempted right after, outside this transaction —
        // `LedgerService.post` opens its own transaction and composing two
        // independent ones inside one another buys nothing — with
        // `outbox.drain` guaranteeing it eventually happens even if that
        // immediate attempt fails.
        const settled = await this.prisma.$transaction(async (tx) => {
          await tx.evSession.update({
            where: { id: session.id },
            data: {
              poolAmount: pool,
              greenAmount: green,
              deferredAmount: deferred,
              programVersion: CURRENT_REFERRAL_PROGRAM_VERSION,
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

          let greenLotId: string | null = null;
          if (green.greaterThan(0)) {
            const created = await this.bonusEngine.accrue(
              { walletId, type: BonusEntryType.ACCRUAL_PURCHASE, amount: green, sourceTransactionId: transaction.id },
              tx,
            );
            greenLotId = created.id;
          }

          // Spec §15's own order, mirrored: existing lots first, then this
          // session's own new one.
          await this.deferredBonusLots.advanceExistingLots(userId, cost, transaction.id, tx);
          if (deferred.greaterThan(0)) {
            await this.deferredBonusLots.createLot(userId, deferred, transaction.id, tx);
          }

          // Every USER-type level (L1/L2/L3) straight into its wallet; a
          // PARTNER-type level is skipped here — its share is the
          // ledger-only leg `postEvContributionLedgerIdempotent` posts.
          await this.referralService.creditChainShares(chain, { l1, l2, l3 }, transaction.id, tx);

          await this.outbox.publish(tx, {
            aggregateType: 'Transaction',
            aggregateId: transaction.id,
            eventType: 'ev.contribution.ledger_post',
            payload: {
              partnerId,
              pool: pool.toString(),
              green: green.toString(),
              deferred: deferred.toString(),
              l1: l1.toString(),
              l2: l2.toString(),
              l3: l3.toString(),
              tutak: tutak.toString(),
              chain: chain.map(serializeChainLevel),
              transactionId: transaction.id,
            },
          });

          const completedTx = await this.transactionsService.markCompleted(
            transaction.id,
            { bonusEarnedAmount: green },
            tx,
          );

          return { greenLotId, completedTx };
        });
        accruedLotId = settled.greenLotId;
        completed = settled.completedTx;

        // Fast path. Never fatal, the same reasoning as
        // QrLedgerMirrorService: the customer has already paid for and
        // been credited on this charge, and a bookkeeping failure must
        // not unwind that — the outbox event published above is what
        // turns "logged and forgotten" into "guaranteed, just not yet".
        await this.postEvContributionLedgerIdempotent(
          partnerId,
          { pool, green, deferred, l1, l2, l3, tutak, chain },
          transaction.id,
        ).catch((e) =>
          this.logger.error(
            `Failed to post EV contribution ledger entry for session ${session.id} (outbox will retry)`,
            e,
          ),
        );
      }

      if (!completed) {
        completed = await this.transactionsService.markCompleted(transaction.id, {
          bonusEarnedAmount: green,
        });
      }

      return {
        transactionId: completed.id,
        energyKwh: energyKwh.toString(),
        cost: cost.toString(),
        bonusApplied: bonusToApply.toString(),
        bonusEarned: green.toString(),
      };
    } catch (err) {
      // A settled reservation is already spent and must be reversed rather
      // than released; an active one is simply returned to available.
      // compensateReservation picks the right leg — release alone used to
      // throw here and leave the customer's points spent on a FAILED session.
      if (reservationId) {
        await this.bonusEngine
          .compensateReservation(reservationId, 'ev_stop_failed')
          .catch((e) => this.compensationFailed('bonus reservation', reservationId!, session.id, e));
      }
      if (accruedLotId) {
        await this.bonusEngine
          .reverseAccrualLot(accruedLotId, 'ev_stop_failed')
          .catch((e) => this.compensationFailed('bonus accrual', accruedLotId!, session.id, e));
      }

      // Without this the connector stayed CHARGING forever: the station was
      // permanently unusable and the partner silently lost the revenue.
      await this.releaseConnector(session.connectorId, session.id).catch((e) =>
        this.logger.error(
          `Failed to free connector ${session.connectorId} after EV stop failure`,
          e,
        ),
      );

      await this.transactionsService.markFailed(
        transaction.id,
        err instanceof Error ? err.message : 'unknown_error',
      );
      throw err;
    }
  }

  /**
   * Posts the accounting side of an EV session's settled contribution pool:
   * the partner now owes the platform the full pool, split across the
   * customer's immediate green bonus, their deferred/locked bonus, up to
   * three referrer legs, and TuTak's own residual share. Mirrors
   * `PurchaseIntentsService.postContributionLedger` leg for leg — same
   * account types, same directions — because this is the same kind of
   * event (a partner-funded contribution pool), not a new one.
   *
   * Idempotent: both the fast-path attempt in `stopOnce` and the outbox's
   * guaranteed retry call this for the same `transactionId`, and — in a
   * slow-fast-path pile-up — could run concurrently. The check-then-post
   * below is only race-free under Serializable isolation: at READ COMMITTED
   * two overlapping calls could each see "no existing posting" and both
   * insert one. Serializable's write-skew detection is what turns that into
   * a retried loser instead of a duplicate accounting entry — the same
   * reason `ReferralService.runSerializable` and
   * `PurchaseIntentRefundService.runSerializable` exist.
   */
  private async postEvContributionLedgerIdempotent(
    partnerId: string,
    amounts: {
      pool: Decimal;
      green: Decimal;
      deferred: Decimal;
      l1: Decimal;
      l2: Decimal;
      l3: Decimal;
      tutak: Decimal;
      chain: ReferralChainLevel[];
    },
    transactionId: string,
  ) {
    if (amounts.pool.lessThanOrEqualTo(0)) return;

    const run = async (tx: Tx) => {
      const existing = await tx.ledgerTransaction.findFirst({
        where: { kind: 'ev.charging.contribution', sourceType: 'Transaction', sourceId: transactionId },
        select: { id: true },
      });
      if (existing) return;

      const [partnerAccount, bonusLiabilityAccount, revenueAccount] = await Promise.all([
        this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId }, tx),
        this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }, tx),
        this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }, tx),
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

      const postings = [
        { accountId: partnerAccount.id, direction: PostingDirection.DEBIT, amount: amounts.pool },
        ...(customerLiability.greaterThan(0)
          ? [{ accountId: bonusLiabilityAccount.id, direction: PostingDirection.CREDIT, amount: customerLiability }]
          : []),
        ...partnerReferrerPostings.filter((p): p is NonNullable<typeof p> => p !== null),
        ...(amounts.tutak.greaterThan(0)
          ? [{ accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: amounts.tutak }]
          : []),
      ];

      await this.ledger.post(
        {
          kind: 'ev.charging.contribution',
          sourceType: 'Transaction',
          sourceId: transactionId,
          postings,
        },
        tx,
      );
    };

    return this.runSerializable(run);
  }

  /**
   * Serializable `$transaction`, retried on a serialization failure or
   * deadlock — same idiom as `ReferralService.runSerializable` and
   * `PurchaseIntentRefundService.runSerializable`.
   */
  private async runSerializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err) {
        const code = (err as { code?: string })?.code;
        const message = err instanceof Error ? err.message : '';
        const retryable =
          code === '40001' ||
          code === '40P01' ||
          /write conflict|deadlock|could not serialize/i.test(message);
        if (!retryable || attempt === maxAttempts) throw err;
        const delay = Math.floor(2 ** attempt * 5 * (0.5 + Math.random()));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    // Unreachable — the loop above always returns or throws.
    throw new Error('runSerializable exhausted retries without a result');
  }

  /**
   * Closes sessions that were started and never stopped.
   *
   * Without this a connector stayed CHARGING for as long as the row existed:
   * the bay was physically unusable, every subsequent customer was turned
   * away, and the partner lost the revenue silently. The charge is not billed
   * — an abandoned session has no trustworthy meter reading — which is the
   * right trade against a bay lost forever.
   */
  async expireStaleSessions(now = new Date()) {
    const cutoff = new Date(now.getTime() - STALE_SESSION_HOURS * 3_600_000);
    const stale = await this.prisma.evSession.findMany({
      where: { status: EvSessionStatus.CHARGING, startedAt: { lte: cutoff } },
      select: { id: true, connectorId: true },
    });

    let closed = 0;
    for (const session of stale) {
      try {
        await this.releaseConnector(session.connectorId, session.id);
        closed += 1;
      } catch (err) {
        this.logger.error(`Failed to close stale EV session ${session.id}`, err as Error);
      }
    }

    if (closed > 0) this.logger.warn(`Closed ${closed} abandoned EV session(s)`);
    return closed;
  }

  /**
   * Returns the bay to service and marks the session unusable.
   *
   * Every failure path in `stop()` ends here. A connector left CHARGING is
   * physically unusable until someone edits the database, so this must run
   * whether the failure was a rejected reading, a ledger error or a crash
   * mid-settlement.
   */
  /**
   * A rollback that itself failed — the state nothing else will find.
   *
   * Reconciliation sees a consistent ledger, and the expiry sweep only
   * returns holds that are still active, so a settled reservation whose
   * reversal failed is invisible to both. The customer simply has fewer
   * points than they should for a charge that never completed, and without
   * this the only record is a log line.
   */
  private async compensationFailed(
    what: string,
    entityId: string,
    sessionId: string,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Failed to compensate ${what} after EV stop failure: ${message}`);
    await this.alerts.fire({
      severity: 'critical',
      key: `compensation.failed:ev:${entityId}`,
      title: `A customer's ${what} could not be rolled back`,
      body:
        `A charging session failed to stop cleanly and the compensating action for its ${what} ` +
        'also failed. The customer has been charged points for a session that did not complete, ' +
        'and nothing else in the platform will find this. This one needs a person.',
      context: { entityId, sessionId, error: message.slice(0, 200) },
    });
  }

  private releaseConnector(connectorId: string, sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.evConnector.update({
        where: { id: connectorId },
        data: { status: EvConnectorStatus.AVAILABLE },
      });
      // Only a session that is still charging may be invalidated. This used
      // to be an unconditional update, which meant a failing caller could
      // stamp INVALID over a session that had already completed and billed —
      // a charge the customer paid, the CDR recorded and the partner will be
      // settled for, filed under a status that says it never happened.
      // COMPLETED and CANCELLED are terminal; nothing may walk them back.
      await tx.evSession.updateMany({
        where: { id: sessionId, status: EvSessionStatus.CHARGING },
        data: { status: EvSessionStatus.INVALID, stoppedAt: new Date() },
      });
    });
  }

  /**
   * A customer's charging history — spec §1.3 lists "charging-session
   * detail/history" among the surfaces that must identify the partner.
   *
   * The brand comes from the session's own transaction snapshot when there is
   * one, which is the honest answer: that is the operator's identity as
   * recorded when the session became a customer operation. A session still
   * running has no transaction yet, so it falls back to the station's partner
   * *as it is now* — which is correct, because "now" is when that session is
   * happening.
   */
  async historyForUser(userId: string) {
    const sessions = await this.prisma.evSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        connector: { include: { station: { include: { partner: { select: { id: true, displayName: true, logoAssetId: true } } } } } },
        cdr: true,
        transaction: {
          select: { partnerId: true, brandDisplayName: true, brandLogoAssetId: true },
        },
      },
    });

    const brandSources = sessions.map((session) =>
      session.transaction ?? {
        partnerId: session.connector.station.partner.id,
        brandDisplayName: session.connector.station.partner.displayName,
        brandLogoAssetId: session.connector.station.partner.logoAssetId,
      },
    );
    const brands = await this.media.brandsFor(brandSources);

    return sessions.map((session, index) => {
      const { transaction: _txn, ...rest } = session;
      return { ...rest, partnerBrand: brands.get(brandSources[index]!) ?? null };
    });
  }
}
