import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BonusEntryType,
  EvCdrReconciliation,
  EvSessionStatus,
  LedgerAccountType,
  Prisma,
  PostingDirection,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseMoney, roundCharge, roundIssued } from '../../common/utils/money';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionsService } from '../transactions/transactions.service';
import { PhoneVerificationService } from '../auth/phone-verification.service';
import { PartnersService } from '../partners/partners.service';
import { AlertsService } from '../../infrastructure/alerts/alerts.service';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../ledger/outbox.service';
import {
  CURRENT_REFERRAL_PROGRAM_VERSION,
  ReferralChainLevel,
  ReferralPoolSplit,
  ReferralService,
} from '../referral/referral.service';
import { FastChargeSessionSettleDto } from './dto/fastcharge-session-settle.dto';

type Tx = Prisma.TransactionClient;

/** JSON-safe wire shape of one `ReferralChainLevel`, for the outbox payload — see `EvSessionsService`'s own copy. */
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

/**
 * How far a FastCharge-reported `finalAmount` may disagree with
 * `energyKwh × appliedCustomerRatePerKwh` before settlement is refused.
 * Real invoices round; this is not a fraud check the way
 * `EvSessionsService`'s `assertDeliverable` is (FastCharge's own meter and
 * tariff are authoritative, not something this side can independently
 * verify) — it exists only to catch a malformed payload (wrong currency
 * unit, a field swapped for another) before it becomes a customer's bill.
 */
const RECONCILE_TOLERANCE_PCT = new Decimal('0.01');
const RECONCILE_TOLERANCE_FLOOR = new Decimal('1');

/**
 * Settles one completed FastCharge session — the financial heart of
 * docs/FASTCHARGE_INTEGRATION_2026-08-25.md.
 *
 * TuTak buys energy from FastCharge at a fixed wholesale rate
 * (`Partner.evWholesaleRatePerKwh`) and resells it at whatever tariff
 * FastCharge actually applied to this customer for this session
 * (`appliedCustomerRatePerKwh` — never a station default, never inferred).
 * The difference is TuTak's margin. Of that margin, only the slice up to
 * `Partner.evMarginReferralCapPerKwh` AMD/kWh enters the platform's
 * ordinary green/deferred/L1/L2/L3/TuTak split
 * (`ReferralService.computePoolSplit` — the exact same six-leg rule a
 * confirmed `PurchaseIntent` or an internal `EvSession` uses, never a
 * second copy of those percentages); margin above the cap is undivided
 * TuTak revenue that never enters the split at all.
 *
 * Worked examples (confirmed by Arman, reproduced as passing tests in
 * `fastcharge-settlement.int-spec.ts` and `fastcharge-settlement.service.spec.ts`):
 *  - 80 AMD/kWh applied, 75 wholesale → margin 5 → all 5 through the split.
 *  - 105 AMD/kWh applied → margin 30 → 20 through the split, 10 straight
 *    TuTak revenue.
 *  - 120 AMD/kWh applied → margin 45 → 20 through the split, 25 straight
 *    TuTak revenue.
 *
 * Idempotent two ways, both required: `IdempotencyService.run`, scoped per
 * partner and keyed by FastCharge's own `fastChargeSessionId`, answers a
 * literal retry (same webhook delivery replayed) without redoing any work.
 * The `EvSession.fastChargeExternalSessionId` unique index is the backstop
 * for everything that isn't a literal retry — two concurrent deliveries for
 * the same session racing past the idempotency check (a lost/expired lease,
 * per `IdempotencyService`'s own docblock), or a second delivery arriving
 * with a superficially different request body. Whichever loses the unique
 * index returns the winner's already-settled row rather than erroring or
 * double-posting — see `settleOnce`'s catch around the session insert.
 */
@Injectable()
export class FastChargeSettlementService {
  private readonly logger = new Logger(FastChargeSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly walletService: WalletService,
    private readonly transactionsService: TransactionsService,
    private readonly phoneVerification: PhoneVerificationService,
    private readonly partners: PartnersService,
    private readonly referralService: ReferralService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly alerts: AlertsService,
  ) {
    // Guaranteed-retry backstop for the fast-path ledger post below — same
    // shape as `EvSessionsService`'s own `ev.contribution.ledger_post`
    // registration, for the same reason: the wallet-side effects and the
    // durable promise to post their accounting entry commit atomically, so
    // a transient failure on the immediate attempt is only ever a delay.
    this.outbox.register('fastcharge.margin.ledger_post', async (payload) => {
      const chain = (payload.chain as SerializedChainLevel[] | undefined) ?? [];
      await this.postMarginLedgerIdempotent(
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
          uncappedRevenue: new Decimal(payload.uncappedRevenue as string),
        },
        payload.transactionId as string,
      );
    });
  }

  /**
   * The margin/split math alone, with no I/O — the piece
   * `fastcharge-settlement.service.spec.ts` exercises directly against the worked
   * examples, independent of the database.
   */
  static computeMargin(params: {
    appliedCustomerRatePerKwh: Decimal;
    wholesaleRatePerKwh: Decimal;
    marginReferralCapPerKwh: Decimal;
    energyKwh: Decimal;
  }) {
    const marginPerKwh = Decimal.max(
      params.appliedCustomerRatePerKwh.minus(params.wholesaleRatePerKwh),
      0,
    );
    const cappedMarginPerKwh = Decimal.min(marginPerKwh, params.marginReferralCapPerKwh);
    const uncappedMarginPerKwh = Decimal.max(
      marginPerKwh.minus(params.marginReferralCapPerKwh),
      0,
    );
    const pool = roundIssued(cappedMarginPerKwh.times(params.energyKwh));
    const uncappedRevenue = roundIssued(uncappedMarginPerKwh.times(params.energyKwh));
    return { marginPerKwh, cappedMarginPerKwh, uncappedMarginPerKwh, pool, uncappedRevenue };
  }

  async settle(partnerId: string, dto: FastChargeSessionSettleDto) {
    return this.idempotency.run(
      { scope: `fastcharge-settle:${partnerId}`, key: dto.fastChargeSessionId, request: dto },
      () => this.settleOnce(partnerId, dto),
    );
  }

  private async settleOnce(partnerId: string, dto: FastChargeSessionSettleDto) {
    const already = await this.prisma.evSession.findUnique({
      where: { fastChargeExternalSessionId: dto.fastChargeSessionId },
    });
    if (already) return this.toResult(already);

    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundException('Partner not found');
    if (!partner.isActive) {
      throw new BadRequestException('This charging network is not currently active');
    }

    const station = await this.prisma.evStation.findUnique({
      where: { externalStationId: dto.fastChargeStationId },
    });
    if (!station || station.partnerId !== partnerId) {
      throw new BadRequestException('Unknown FastCharge station — sync it before settling a session on it');
    }
    const connector = await this.prisma.evConnector.findUnique({
      where: { externalConnectorId: dto.fastChargeConnectorId },
    });
    if (!connector || connector.stationId !== station.id) {
      throw new BadRequestException('Unknown FastCharge connector — sync it before settling a session on it');
    }

    const link = await this.prisma.fastChargeCustomerLink.findUnique({
      where: {
        partnerId_fastChargeCustomerId: { partnerId, fastChargeCustomerId: dto.fastChargeCustomerId },
      },
    });
    if (!link) {
      // Never inferred — see `FastChargeCustomersService`'s docblock for why
      // this is a hard rejection rather than an implicit create.
      throw new BadRequestException(
        `FastCharge customer ${dto.fastChargeCustomerId} is not linked to a TuTak account`,
      );
    }
    const userId = link.userId;

    const energyKwh = parseMoney(dto.energyKwh, 'energyKwh', { allowZero: false });
    const appliedRate = parseMoney(dto.appliedCustomerRatePerKwh, 'appliedCustomerRatePerKwh', {
      allowZero: false,
    });
    const reportedFinal = parseMoney(dto.finalAmount, 'finalAmount');

    const expectedCost = roundCharge(energyKwh.times(appliedRate));
    const tolerance = Decimal.max(expectedCost.times(RECONCILE_TOLERANCE_PCT), RECONCILE_TOLERANCE_FLOOR);
    if (reportedFinal.minus(expectedCost).abs().greaterThan(tolerance)) {
      throw new BadRequestException(
        `finalAmount (${reportedFinal.toString()}) does not reconcile with energyKwh × ` +
          `appliedCustomerRatePerKwh (${expectedCost.toString()})`,
      );
    }
    // FastCharge's own reported figure is the authoritative bill — requirement 4's
    // "the final charging amount" — the product above is only a sanity check.
    const cost = reportedFinal;

    const bonusToApply = dto.bonusAmountToApply
      ? parseMoney(dto.bonusAmountToApply, 'bonusAmountToApply')
      : new Decimal(0);
    if (bonusToApply.greaterThan(cost)) {
      throw new BadRequestException('Bonus applied cannot exceed the session cost');
    }
    // Spec §11's own ceiling, reused unchanged (`PurchaseIntentsService`
    // enforces the identical rule) — EV charging is not a different enough
    // context to need its own field; `Partner.maxBonusPaymentPercent` is
    // already generic across every payment surface.
    const maxBonusUsable = roundCharge(cost.times(partner.maxBonusPaymentPercent).dividedBy(100));
    if (bonusToApply.greaterThan(maxBonusUsable)) {
      throw new BadRequestException(
        `This partner allows at most ${partner.maxBonusPaymentPercent}% of the session to be paid with bonus`,
      );
    }

    const wholesaleRatePerKwh = partner.evWholesaleRatePerKwh;
    const marginReferralCapPerKwh = partner.evMarginReferralCapPerKwh;
    const { marginPerKwh, pool, uncappedRevenue } = FastChargeSettlementService.computeMargin({
      appliedCustomerRatePerKwh: appliedRate,
      wholesaleRatePerKwh,
      marginReferralCapPerKwh,
      energyKwh,
    });

    const transaction = await this.transactionsService.create({
      userId,
      partnerId,
      type: TransactionType.EV_CHARGING,
      amount: cost,
      bonusAppliedAmount: bonusToApply,
      description: `FastCharge session at ${station.name}`,
      metadata: {
        fastChargeSessionId: dto.fastChargeSessionId,
        fastChargeCustomerId: dto.fastChargeCustomerId,
        energyKwh: energyKwh.toString(),
      },
    });

    let reservationId: string | null = null;
    let accruedLotId: string | null = null;
    try {
      const walletId = await this.walletService.getWalletIdForUser(userId);
      if (bonusToApply.greaterThan(0)) {
        const reservation = await this.bonusEngine.reserve(walletId, bonusToApply, transaction.id);
        reservationId = reservation.reservationId;
        await this.bonusEngine.settleReservation(reservationId);
      }

      // Business decision, mirroring `EvSessionsService.stopOnce`'s M7
      // guard exactly: a partner owner/staff charging at their own
      // affiliated station earns no TuTak benefit from it, and an
      // unverified phone cannot earn. Unlike that flow, TuTak's *own*
      // margin revenue is never gated on either — it is recognised in
      // every case below via `split.tutak`, which absorbs the whole pool
      // when there is no eligible customer to share it with. Only the
      // wallet-side distribution (green/deferred/referrer legs) is gated.
      const canEarn = await this.phoneVerification
        .assertCanEarn(userId)
        .then(() => true)
        .catch(() => false);
      const affiliated = await this.partners.isAffiliated(partnerId, userId);
      const eligible = canEarn && !affiliated && pool.greaterThan(0);

      let chain: ReferralChainLevel[] = [];
      let split: ReferralPoolSplit;
      if (eligible) {
        chain = await this.referralService.resolveReferralChain(userId);
        split = this.referralService.computePoolSplit(pool, chain);
      } else {
        split = {
          pool,
          green: new Decimal(0),
          deferred: new Decimal(0),
          l1: new Decimal(0),
          l2: new Decimal(0),
          l3: new Decimal(0),
          tutak: pool,
          chain: [],
        };
      }
      const { green, deferred, l1, l2, l3, tutak } = split;
      const l1Entry = chain.find((c) => c.level === 1) ?? null;
      const l2Entry = chain.find((c) => c.level === 2) ?? null;
      const l3Entry = chain.find((c) => c.level === 3) ?? null;

      let settled;
      try {
        settled = await this.prisma.$transaction(async (tx) => {
        const session = await tx.evSession.create({
            data: {
              connectorId: connector.id,
              userId,
              status: EvSessionStatus.COMPLETED,
              startedAt: dto.startedAt ? new Date(dto.startedAt) : new Date(),
              stoppedAt: dto.stoppedAt ? new Date(dto.stoppedAt) : new Date(),
              energyKwh,
              cost,
              transactionId: transaction.id,
              fastChargeExternalSessionId: dto.fastChargeSessionId,
              fastChargeCustomerId: dto.fastChargeCustomerId,
              stationRetailRatePerKwh: station.standardRetailRatePerKwh,
              appliedCustomerRatePerKwh: appliedRate,
              wholesaleRatePerKwh,
              marginReferralCapPerKwh,
              marginPerKwh,
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
            totalTimeSec:
              dto.startedAt && dto.stoppedAt
                ? Math.max(
                    0,
                    Math.round((new Date(dto.stoppedAt).getTime() - new Date(dto.startedAt).getTime()) / 1000),
                  )
                : 0,
            // FastCharge's own report *is* the settled CDR — there is
            // nothing further to reconcile it against, unlike a roaming
            // OCPI session where our figure and the CPO's arrive separately.
            reconciliation: EvCdrReconciliation.NOT_APPLICABLE,
            raw: { ...dto } as unknown as Prisma.InputJsonValue,
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
        await this.deferredBonusLots.advanceExistingLots(userId, cost, transaction.id, tx);
        if (deferred.greaterThan(0)) {
          await this.deferredBonusLots.createLot(userId, deferred, transaction.id, tx);
        }
        await this.referralService.creditChainShares(chain, { l1, l2, l3 }, transaction.id, tx);

        await this.outbox.publish(tx, {
          aggregateType: 'Transaction',
          aggregateId: transaction.id,
          eventType: 'fastcharge.margin.ledger_post',
          payload: {
            partnerId,
            pool: pool.toString(),
            green: green.toString(),
            deferred: deferred.toString(),
            l1: l1.toString(),
            l2: l2.toString(),
            l3: l3.toString(),
            tutak: tutak.toString(),
            uncappedRevenue: uncappedRevenue.toString(),
            chain: chain.map(serializeChainLevel),
            transactionId: transaction.id,
          },
        });

        const completedTx = await this.transactionsService.markCompleted(
          transaction.id,
          { bonusEarnedAmount: green },
          tx,
        );

        return { duplicate: false as const, session, greenLotId, completedTx };
        });
      } catch (err) {
        // Postgres aborts the whole transaction on the first statement
        // error, so the unique-violation backstop cannot look anything up
        // from inside the same transaction that hit it (a `SELECT` against
        // an already-aborted transaction fails too — "current transaction
        // is aborted"). The lookup has to happen after this transaction has
        // fully rolled back, against `this.prisma` directly, once the
        // concurrent winner's INSERT (or its own transaction) has committed.
        if ((err as { code?: string })?.code === 'P2002') {
          const existing = await this.prisma.evSession.findUniqueOrThrow({
            where: { fastChargeExternalSessionId: dto.fastChargeSessionId },
          });
          settled = { duplicate: true as const, session: existing, greenLotId: null, completedTx: null };
        } else {
          throw err;
        }
      }

      if (settled.duplicate) {
        // Lost the create race — nothing here to compensate; the winner's
        // transaction already carries the reservation this call also made,
        // so ours must be reversed, not left dangling as a second charge.
        if (reservationId) {
          await this.bonusEngine.compensateReservation(reservationId, 'fastcharge_duplicate_delivery');
        }
        await this.transactionsService.markFailed(transaction.id, 'duplicate_fastcharge_session');
        return this.toResult(settled.session);
      }

      accruedLotId = settled.greenLotId;

      // Fast path — never fatal, same reasoning as `EvSessionsService`'s own
      // copy: the customer has already been billed and credited, and a
      // bookkeeping failure must not unwind that. The outbox event
      // published above guarantees it eventually happens.
      await this.postMarginLedgerIdempotent(
        partnerId,
        { pool, green, deferred, l1, l2, l3, tutak, chain, uncappedRevenue },
        transaction.id,
      ).catch((e) =>
        this.logger.error(
          `Failed to post FastCharge margin ledger entry for session ${settled.session.id} (outbox will retry)`,
          e,
        ),
      );

      return this.toResult(settled.session);
    } catch (err) {
      if (reservationId) {
        await this.bonusEngine
          .compensateReservation(reservationId, 'fastcharge_settle_failed')
          .catch((e) => this.compensationFailed('bonus reservation', reservationId!, dto.fastChargeSessionId, e));
      }
      if (accruedLotId) {
        await this.bonusEngine
          .reverseAccrualLot(accruedLotId, 'fastcharge_settle_failed')
          .catch((e) => this.compensationFailed('bonus accrual', accruedLotId!, dto.fastChargeSessionId, e));
      }
      await this.transactionsService.markFailed(
        transaction.id,
        err instanceof Error ? err.message : 'unknown_error',
      );
      throw err;
    }
  }

  /**
   * Posts the accounting side of a settled FastCharge session's margin.
   * Mirrors `EvSessionsService.postEvContributionLedgerIdempotent` leg for
   * leg, with one structural difference: that method's debit is the
   * *station's own partner*, because in the internal-station program the
   * partner funds the pool out of its own accrual rate. Here the margin is
   * TuTak's own money (FastCharge is not funding a bonus programme, TuTak
   * is reselling energy it bought wholesale) — but the debit is still
   * FastCharge's own `PARTNER_PAYABLE` account, for a different reason:
   * FastCharge collects the walk-in-equivalent amount from the customer
   * (partly outside TuTak, per requirement 2) while only owing TuTak the
   * wholesale cost, so crediting TuTak's margin out of FastCharge's payable
   * balance is what makes TuTak's later settlement with FastCharge net out
   * to exactly the wholesale amount — the margin never leaves FastCharge's
   * side to begin with. See the completion report's ledger section for the
   * full accounting walk-through.
   *
   * Idempotent the same way: check-then-insert under Serializable
   * isolation, retried on a write conflict — `EvSessionsService`'s own
   * `runSerializable` copy.
   */
  private async postMarginLedgerIdempotent(
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
      uncappedRevenue: Decimal;
    },
    transactionId: string,
  ) {
    const totalDebit = amounts.pool.plus(amounts.uncappedRevenue);
    if (totalDebit.lessThanOrEqualTo(0)) return;

    const run = async (tx: Tx) => {
      const existing = await tx.ledgerTransaction.findFirst({
        where: { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction', sourceId: transactionId },
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

      const revenueCredit = amounts.tutak.plus(amounts.uncappedRevenue);

      const postings = [
        { accountId: partnerAccount.id, direction: PostingDirection.DEBIT, amount: totalDebit },
        ...(customerLiability.greaterThan(0)
          ? [{ accountId: bonusLiabilityAccount.id, direction: PostingDirection.CREDIT, amount: customerLiability }]
          : []),
        ...partnerReferrerPostings.filter((p): p is NonNullable<typeof p> => p !== null),
        ...(revenueCredit.greaterThan(0)
          ? [{ accountId: revenueAccount.id, direction: PostingDirection.CREDIT, amount: revenueCredit }]
          : []),
      ];

      await this.ledger.post(
        { kind: 'fastcharge.margin.settlement', sourceType: 'Transaction', sourceId: transactionId, postings },
        tx,
      );
    };

    return this.runSerializable(run);
  }

  /** Same retried-Serializable-transaction idiom as `EvSessionsService.runSerializable`. */
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
          code === '40001' || code === '40P01' || /write conflict|deadlock|could not serialize/i.test(message);
        if (!retryable || attempt === maxAttempts) throw err;
        const delay = Math.floor(2 ** attempt * 5 * (0.5 + Math.random()));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error('runSerializable exhausted retries without a result');
  }

  private compensationFailed(what: string, entityId: string, fastChargeSessionId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Failed to compensate ${what} after FastCharge settlement failure: ${message}`);
    this.alerts
      .fire({
        severity: 'critical',
        key: `compensation.failed:fastcharge:${entityId}`,
        title: `A customer's ${what} could not be rolled back`,
        body:
          `A FastCharge session settlement failed to complete cleanly and the compensating action for ` +
          `its ${what} also failed. This needs a person.`,
        context: { entityId, fastChargeSessionId, error: message.slice(0, 200) },
      })
      .catch(() => undefined);
  }

  private toResult(session: {
    id: string;
    transactionId: string | null;
    energyKwh: Decimal | null;
    cost: Decimal | null;
    greenAmount: Decimal | null;
    poolAmount: Decimal | null;
    uncappedMarginRevenueAmount: Decimal | null;
    marginPerKwh: Decimal | null;
  }) {
    return {
      sessionId: session.id,
      transactionId: session.transactionId,
      energyKwh: session.energyKwh?.toString() ?? '0',
      cost: session.cost?.toString() ?? '0',
      bonusEarned: session.greenAmount?.toString() ?? '0',
      marginPerKwh: session.marginPerKwh?.toString() ?? '0',
      marginPoolAmount: session.poolAmount?.toString() ?? '0',
      uncappedMarginRevenueAmount: session.uncappedMarginRevenueAmount?.toString() ?? '0',
    };
  }
}
