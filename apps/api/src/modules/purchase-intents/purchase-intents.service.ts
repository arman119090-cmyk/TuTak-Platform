import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  BonusEntryType,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  PurchaseIntentStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { parseMoney, parsePositiveMoney, roundCharge, roundIssued } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaViewService } from '../media/media-view.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { LedgerService } from '../ledger/ledger.service';
import { PartnersService } from '../partners/partners.service';
import { CURRENT_REFERRAL_PROGRAM_VERSION, ReferralChainLevel, ReferralService } from '../referral/referral.service';
import { TransactionsService } from '../transactions/transactions.service';
import { WalletService } from '../wallet/wallet.service';
import { CreatePurchaseIntentDto } from './dto/create-purchase-intent.dto';
import { RejectPurchaseIntentDto } from './dto/reject-purchase-intent.dto';

type Tx = Prisma.TransactionClient;

/**
 * The new standard purchase flow — spec §7-16. Additive alongside the
 * existing `POST /qr/redeem` (see
 * docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md §3 for why that one is left
 * running rather than migrated tonight).
 *
 * One purchase, confirmed once, produces in a single money-moving step:
 *  - the customer's green bonus (spec §12's 20% pool share, immediate);
 *  - progress on every one of the customer's already-open deferred lots,
 *    then a new deferred lot for *this* purchase's own 30% share (spec §15,
 *    in that order — a purchase never progresses its own new lot);
 *  - the direct referrer's recurring 20% share, if the customer has one;
 *  - the partner's contribution and bonus-redemption-compensation ledger
 *    entries, kept as two separate postings rather than one netted figure
 *    (spec §23).
 *
 * Business rule (2026-08-16, Arman): `confirm()`/`reject()` — the manual
 * cashier action below — applies only to *non-integrated* partners. A
 * *verified integrated* partner (API, POS, EV/OCPI — a `PartnerIntegration`
 * at `PartnerIntegrationStatus.ACTIVE`) is meant to have its own confirmed
 * integration event finalize the transaction and bonus accrual directly,
 * with no cashier confirmation step at all — the same canonical settlement
 * this method runs, just triggered by the integration rather than a tap.
 * `EvSessionsService.stopOnce()` is the first working example of exactly
 * this shape, though it predates `PartnerIntegration` and doesn't reference
 * it. This rule is recorded here as policy, not yet wired to a generic
 * event-ingestion path for API/POS: `PartnerIntegration` today is a pure
 * registry with zero downstream readers (confirmed by inspection), and no
 * real API/POS partner has specified how it would authenticate, what an
 * event contains, or how replay/idempotency is handled. Building that
 * without a genuine specification would be inventing a protocol, not
 * implementing a business rule — see docs/HARDENING_AUDIT_2026-08-16.md §M
 * item 8.
 */
@Injectable()
export class PurchaseIntentsService {
  private readonly logger = new Logger(PurchaseIntentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly walletService: WalletService,
    private readonly partnersService: PartnersService,
    private readonly transactionsService: TransactionsService,
    private readonly referralService: ReferralService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly ledger: LedgerService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly media: MediaViewService,
  ) {}

  async findByIdOrThrow(id: string) {
    const intent = await this.prisma.purchaseIntent.findUnique({ where: { id } });
    if (!intent) throw new NotFoundException('Purchase intent not found');
    return intent;
  }

  listForPartner(partnerId: string, status?: PurchaseIntentStatus) {
    return this.prisma.purchaseIntent.findMany({
      where: { partnerId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Swaps the raw brand-snapshot columns for the renderable `partnerBrand`
   * the client's `PurchaseIntentDto` declares — spec §4.
   *
   * A separate step rather than something `findByIdOrThrow` does, because
   * `findByIdOrThrow` is also the internal lookup used by `confirm`,
   * `reject` and the expiry sweep, none of which want a formatted DTO and
   * all of which would then be paying for an extra query.
   */
  async toDto<T extends { partnerId: string; brandDisplayName: string | null; brandLogoAssetId: string | null }>(
    intent: T,
  ) {
    const { brandDisplayName: _name, brandLogoAssetId: _asset, ...rest } = intent;
    const brand = await this.media.brandFor(intent);
    return { ...rest, partnerBrand: brand! };
  }

  async toDtos<T extends { partnerId: string; brandDisplayName: string | null; brandLogoAssetId: string | null }>(
    intents: T[],
  ) {
    const brands = await this.media.brandsFor(intents);
    return intents.map((intent) => {
      const { brandDisplayName: _name, brandLogoAssetId: _asset, ...rest } = intent;
      return { ...rest, partnerBrand: brands.get(intent)! };
    });
  }

  /**
   * Spec §7 steps 1-8: resolve the partner/branch, snapshot its commercial
   * terms, reserve the requested bonus, and open the confirmation window.
   * No financial ledger entry exists yet — spec §7 step 11 is explicit that
   * those wait for confirmation.
   */
  async create(dto: CreatePurchaseIntentDto, customerId: string) {
    const grossAmount = parsePositiveMoney(dto.grossAmount, 'grossAmount');
    const bonusAmountRequested = dto.bonusAmountRequested
      ? parseMoney(dto.bonusAmountRequested, 'bonusAmountRequested')
      : new Decimal(0);
    if (bonusAmountRequested.greaterThan(grossAmount)) {
      throw new BadRequestException('bonusAmountRequested cannot exceed grossAmount');
    }

    // Refuses PENDING_APPROVAL/SUSPENDED/REJECTED partners automatically —
    // see PartnersService.findActiveOrThrow.
    const partner = await this.partnersService.findActiveOrThrow(dto.partnerId);

    // A purchase needs two parties, and neither of them may be the
    // merchant. Same reasoning `QrPaymentsService.redeem` already applies
    // to the old flow: accrual is funded by the partner, so anyone on the
    // partner's side who can create a PurchaseIntent can raise one against
    // themselves for an amount they choose, confirm it with their own
    // staff identity, and collect the pool's green/deferred/referrer share
    // on a purchase that never happened. Affiliation is what is checked,
    // not identity, so two staff members transacting with each other is
    // blocked too, not just self-confirmation — and `isAffiliated` (not
    // the narrower `isMember`) is used deliberately, since most staff are
    // attached to a partner via a partner-scoped role, not a
    // `PartnerMembership` row.
    if (await this.partnersService.isAffiliated(partner.id, customerId)) {
      throw new BadRequestException(
        'You cannot create a purchase intent for a partner you belong to',
      );
    }

    if (dto.partnerBranchId) {
      const branch = await this.prisma.partnerBranch.findUnique({
        where: { id: dto.partnerBranchId },
      });
      if (!branch || branch.partnerId !== partner.id) {
        throw new BadRequestException('This branch does not belong to the given partner');
      }
    }

    // Spec §11: max_bonus_payment_percent is the partner's own ceiling —
    // technically supports up to 100% if the partner permits it and the
    // customer has enough available bonus (the latter is enforced by
    // `bonusEngine.reserve` itself, which throws on insufficient balance).
    const maxUsable = roundCharge(
      grossAmount.times(partner.maxBonusPaymentPercent).dividedBy(100),
    );
    if (bonusAmountRequested.greaterThan(maxUsable)) {
      throw new BadRequestException(
        `This partner allows at most ${partner.maxBonusPaymentPercent}% of the purchase to be paid with bonus`,
      );
    }

    const ordinaryPaymentRemainder = grossAmount.minus(bonusAmountRequested);
    const intentTimeoutSeconds = this.config.get('purchasePolicy.intentTimeoutSeconds', {
      infer: true,
    });

    const transaction = await this.transactionsService.create({
      userId: customerId,
      partnerId: partner.id,
      type: TransactionType.PARTNER_PURCHASE,
      amount: grossAmount,
      bonusAppliedAmount: bonusAmountRequested,
      description: `Purchase at ${partner.displayName}`,
    });

    // One canonical timestamp for both records — computed once, before any
    // async work, and passed to both `reserve()` and `PurchaseIntent.create`
    // below. Computing it twice (once inside `reserve()`, once here) used to
    // stamp the reservation strictly *earlier* than the intent by however
    // long the reservation's own DB writes took, leaving a real window where
    // `releaseExpiredReservations` could sweep the reservation while the
    // intent still looked unexpired to the customer/partner — a confirm
    // attempt in that window failed with no reservation left to settle
    // (independent audit, GitHub issue #28).
    const expiresAt = new Date(Date.now() + intentTimeoutSeconds * 1000);

    let bonusReservationId: string | null = null;
    try {
      if (bonusAmountRequested.greaterThan(0)) {
        const walletId = await this.walletService.getWalletIdForUser(customerId);
        const reservation = await this.bonusEngine.reserve(
          walletId,
          bonusAmountRequested,
          transaction.id,
          intentTimeoutSeconds,
          expiresAt,
        );
        bonusReservationId = reservation.reservationId;
      }

      const intent = await this.prisma.purchaseIntent.create({
        data: {
          customerId,
          partnerId: partner.id,
          partnerBranchId: dto.partnerBranchId,
          grossAmount,
          bonusAmountRequested,
          ordinaryPaymentRemainder,
          // Commercial snapshot — spec §8. Frozen here; later changes to the
          // partner's settings never touch a PurchaseIntent already created.
          negotiatedRateBps: partner.bonusAccrualRateBps,
          maxBonusPaymentPercent: partner.maxBonusPaymentPercent,
          // Brand snapshot — spec §2.2, and frozen for the same reason the
          // commercial snapshot above is. The QR purchase preview, the
          // pending/confirmed/rejected/expired views, and the transaction this
          // becomes must all show one consistent identity, even if the partner
          // replaces its logo while the customer is still standing at the till.
          brandDisplayName: partner.displayName,
          brandLogoAssetId: partner.logoAssetId,
          bonusReservationId,
          sourceTransactionId: transaction.id,
          expiresAt,
        },
      });

      await this.auditService.record({
        actorUserId: customerId,
        action: AuditAction.PURCHASE_INTENT_CREATED,
        entityType: 'PurchaseIntent',
        entityId: intent.id,
        metadata: {
          partnerId: partner.id,
          grossAmount: grossAmount.toString(),
          bonusAmountRequested: bonusAmountRequested.toString(),
        },
      });

      return intent;
    } catch (err) {
      if (bonusReservationId) {
        await this.bonusEngine
          .compensateReservation(bonusReservationId, 'purchase_intent_create_failed')
          .catch((e) =>
            this.logger.error(`Failed to release reservation after intent-create failure: ${e}`),
          );
      }
      await this.transactionsService
        .markFailed(transaction.id, err instanceof Error ? err.message : 'unknown_error')
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Spec §7 steps 9-11, and §12-16 for the pool distribution this triggers.
   * Idempotent via the same conditional-status-flip pattern the rest of this
   * codebase uses for exactly this reason (see `QrPaymentsService.redeem`):
   * exactly one caller moves the intent out of `AWAITING_CONFIRMATION`, and
   * a repeat call — the same staff member double-tapping, a retried request
   * — finds it already resolved and returns that state rather than
   * re-executing.
   */
  async confirm(intentId: string, staffUserId: string) {
    const intent = await this.findByIdOrThrow(intentId);

    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      return intent; // already resolved — idempotent, not an error
    }
    if (intent.expiresAt < new Date()) {
      await this.expireOne(intent);
      throw new BadRequestException('This purchase intent has expired');
    }

    const outcome = await this.settlePurchase(intent, staffUserId);
    if (outcome === 'already-resolved') {
      // Lost the race — someone else confirmed, rejected, or the sweep
      // expired it a moment ago.
      return this.findByIdOrThrow(intentId);
    }

    await this.auditService.record({
      actorUserId: staffUserId,
      action: AuditAction.PURCHASE_INTENT_CONFIRMED,
      entityType: 'PurchaseIntent',
      entityId: intentId,
      metadata: { partnerId: intent.partnerId, grossAmount: intent.grossAmount.toString() },
    });

    return this.findByIdOrThrow(intentId);
  }

  /**
   * Claims the intent and settles it as one atomic unit — the confirming
   * status flip lives *inside* the same `$transaction` as every financial
   * effect it authorizes, not before it. An earlier version flipped the
   * status first, in its own statement, then ran the settlement in a
   * separate transaction: a failure partway through the settlement left
   * the intent permanently `CONFIRMED` with some or none of its financial
   * effects actually applied — the exact "looks successful, isn't" state
   * this method exists to make unreachable. Now a failure anywhere in the
   * block below rolls back the claim along with everything else, so the
   * intent is left exactly as it was — still `AWAITING_CONFIRMATION`, its
   * reservation still `ACTIVE` — and is safe to retry with no manual
   * compensation required.
   *
   * The same reasoning applies to `postContributionLedger` and
   * `postRedemptionCompensation` below: both now take `tx` and pass it to
   * `LedgerService.post`, matching the pattern every other financial
   * engine in this codebase already uses (see `payment-engine.service.ts`).
   * Without it, `LedgerService.post` opens its *own* independent
   * transaction — so the ledger postings could commit permanently even if
   * the rest of this settlement later failed and rolled back, or vice
   * versa: a real accounting entry with no bonus ever reaching the
   * customer's wallet.
   */
  private async settlePurchase(
    intent: Awaited<ReturnType<typeof this.findByIdOrThrow>>,
    staffUserId: string,
  ): Promise<'settled' | 'already-resolved'> {
    // Spec §12: the pool is gross × the *snapshotted* negotiated rate — not
    // whatever the partner's rate is today. Rounded down to the column's own
    // 4-decimal-place precision up front, not left as a raw product.
    const pool = roundIssued(intent.grossAmount.times(intent.negotiatedRateBps).dividedBy(10_000));

    // Read-only, and safe to resolve before the transaction: attribution is
    // immutable once created (spec §5) at every level, so the chain cannot
    // change between this read and the transaction below using it. The
    // 2026-08-22 3-level rework's own single source of truth for the split —
    // see `ReferralService.computePoolSplit`'s docblock for why `tutak` is
    // always the residual, never independently rounded, so all six legs
    // always sum to exactly `pool`.
    const chain = await this.referralService.resolveReferralChain(intent.customerId);
    const split = this.referralService.computePoolSplit(pool, chain);
    const { green, deferred, l1, l2, l3, tutak } = split;
    const l1Entry = chain.find((c) => c.level === 1) ?? null;
    const l2Entry = chain.find((c) => c.level === 2) ?? null;
    const l3Entry = chain.find((c) => c.level === 3) ?? null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Conditional on still being AWAITING_CONFIRMATION, exactly like
        // the rest of this codebase's claim-then-act pattern — but now the
        // claim and the act are the same atomic unit.
        const claimed = await tx.purchaseIntent.updateMany({
          where: { id: intent.id, status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
          data: {
            status: PurchaseIntentStatus.CONFIRMED,
            confirmedByUserId: staffUserId,
            confirmedAt: new Date(),
            // Spec §12's pool split, snapshotted at the moment it is
            // actually posted — a later refund reverses these exact
            // amounts, never today's `purchasePolicy` (independent audit,
            // GitHub issue #28, HEAD 0a9c7d5). `negotiatedRateBps` was
            // already snapshotted at creation; this is the other half of
            // "never recompute from live config" for the pool itself.
            //
            // 2026-08-22 3-level referral rework: `programVersion` is the
            // explicit, persisted eligibility boundary — every purchase
            // confirmed from here on is THREE_LEVEL_V2, and its own
            // per-level referrer snapshot lives in `referrer1..3*`/
            // `tutakAmount` below, never the legacy `referrerAmount` column.
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
        if (claimed.count === 0) return 'already-resolved' as const;

        if (intent.bonusReservationId) {
          await this.bonusEngine.settleReservation(intent.bonusReservationId, tx);
        }
        await this.transactionsService.markCompleted(intent.sourceTransactionId!, {}, tx);

        if (green.greaterThan(0)) {
          const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: intent.customerId } });
          await this.bonusEngine.accrue(
            {
              walletId: wallet.id,
              type: BonusEntryType.ACCRUAL_PURCHASE,
              amount: green,
              sourceTransactionId: intent.sourceTransactionId!,
              pendingHours: 0,
            },
            tx,
          );
        }

        // Spec §15: existing lots first, then this purchase's own new lot —
        // never the other order.
        await this.deferredBonusLots.advanceExistingLots(
          intent.customerId,
          intent.grossAmount,
          intent.sourceTransactionId!,
          tx,
        );
        if (deferred.greaterThan(0)) {
          await this.deferredBonusLots.createLot(
            intent.customerId,
            deferred,
            intent.sourceTransactionId!,
            tx,
          );
        }

        // Every USER-type level (L1/L2/L3) is credited straight into its
        // wallet; a PARTNER-type level is deliberately skipped here — its
        // share is the ledger-only leg `postContributionLedger` posts below.
        await this.referralService.creditChainShares(
          chain,
          { l1, l2, l3 },
          intent.sourceTransactionId!,
          tx,
        );

        await this.postContributionLedger(intent, { pool, green, deferred, l1, l2, l3, tutak, chain }, tx);

        if (intent.bonusAmountRequested.greaterThan(0)) {
          await this.postRedemptionCompensation(intent, tx);
        }

        return 'settled' as const;
      });
    } catch (err) {
      // Nothing to unwind by hand: the transaction above is one atomic
      // unit, so a failure anywhere in it rolled back the status claim
      // together with the reservation settle, the accrual, the deferred
      // lot and both ledger postings. The caller sees the error and the
      // intent is left safely retryable.
      this.logger.error(`Purchase intent ${intent.id} settlement failed and was rolled back: ${err}`);
      throw err;
    }
  }

  /**
   * Spec §12 + §22-24: the full contribution pool, split by who receives
   * each slice, as one balanced double-entry transaction. See the migration
   * doc §3 for why this is one `LedgerService.post()` call rather than
   * being split across the referral module — the referrer legs have to
   * balance against the same purchase's contribution posting.
   *
   * 2026-08-22 3-level rework: up to three referrer legs now, not one. A
   * USER-type level's share is folded into the same `bonusLiabilityAccount`
   * credit as green/deferred (it is spendable wallet value, same as
   * before); a PARTNER-type level gets its own `PARTNER_PAYABLE` credit,
   * one per distinct partner in the chain (at most one, in practice — a
   * partner referrer never continues the chain, so the chain can contain at
   * most one PARTNER entry, always its own terminal level). `tutak` is
   * already the pool's residual (`ReferralService.computePoolSplit`), so it
   * needs no further adjustment for missing levels the way the old
   * single-referrer code needed `.plus(referrer ? 0 : referrerShare)`.
   */
  private async postContributionLedger(
    intent: { id: string; partnerId: string; sourceTransactionId: string | null },
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
    tx: Tx,
  ): Promise<void> {
    if (amounts.pool.lessThanOrEqualTo(0)) return;

    // Deliberately *not* passing `tx` to any `accountFor` call below — same
    // as this method always did, and same as the sibling
    // `postRedemptionCompensation` still does: `settlePurchase`'s own
    // transaction is Read Committed (not Serializable), so a find/create
    // outside it commits immediately and is visible to the next statement
    // either way (see `LedgerService.accountFor`'s own docblock on this).
    // Passing `tx` here once caused a same-process self-deadlock instead: an
    // account created *inside* this still-open transaction is invisible to
    // `postRedemptionCompensation`'s own (tx-less) lookup moments later,
    // whose insert then blocks on this transaction's own uncommitted row —
    // a lock wait this transaction can never resolve because it is itself
    // waiting on that query to return. Caught by the integration suite
    // timing out at Prisma's 5s interactive-transaction default.
    const [partnerAccount, bonusLiabilityAccount, revenueAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId }),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_REVENUE }),
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
          const account = await this.ledger.accountFor({
            type: LedgerAccountType.PARTNER_PAYABLE,
            partnerId: c.partnerId,
          });
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
        kind: 'partner.contribution',
        sourceType: 'PurchaseIntent',
        sourceId: intent.id,
        postings,
      },
      tx,
    );
  }

  /**
   * Spec §2/§23's redemption-compensation leg — always a separate posting
   * from the contribution above, never netted into it.
   */
  private async postRedemptionCompensation(
    intent: {
      id: string;
      partnerId: string;
      bonusAmountRequested: Decimal;
    },
    tx: Tx,
  ): Promise<void> {
    const [partnerAccount, bonusLiabilityAccount] = await Promise.all([
      this.ledger.accountFor({ type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId }),
      this.ledger.accountFor({ type: LedgerAccountType.BONUS_LIABILITY }),
    ]);

    await this.ledger.post(
      {
        kind: 'partner.bonus_redemption_compensation',
        sourceType: 'PurchaseIntent',
        sourceId: intent.id,
        postings: [
          {
            accountId: bonusLiabilityAccount.id,
            direction: PostingDirection.DEBIT,
            amount: intent.bonusAmountRequested,
          },
          {
            accountId: partnerAccount.id,
            direction: PostingDirection.CREDIT,
            amount: intent.bonusAmountRequested,
          },
        ],
      },
      tx,
    );
  }

  /**
   * Spec §26: staff reject and give a reason; nothing about the
   * customer-entered amounts is ever rewritten by staff — only accepted or
   * refused as a whole.
   *
   * The 3-minute window is enforced here exactly as `confirm()` enforces
   * it — expire first, then refuse the action — because without this check
   * a cashier could still reject an intent whose deadline had already
   * passed but that the expiry sweep hadn't reached yet: the row would end
   * up `REJECTED` by a decision made outside the window it was valid for,
   * instead of `EXPIRED` (docs/NEXT_CLAUDE_TASK.md requirement 11,
   * confirmed by independent audit — GitHub issue #28).
   */
  /**
   * Spec §26. The status claim, the reservation release, the source
   * transaction's failure, and the audit record are one atomic unit — a
   * crash or thrown error between them used to be reachable: the status
   * claim was its own statement, committed before the reservation release
   * and transaction-failure calls ran as separate, later statements. A
   * failure in either of those left the intent permanently `REJECTED` with
   * the customer's bonus still `ACTIVE`ly reserved, or the source
   * transaction never marked `FAILED` — and a retry found the intent
   * already terminal and did nothing to repair it (independent audit,
   * GitHub issue #28, HEAD `0a9c7d5`). Mirrors `settlePurchase`'s own
   * atomic-transaction shape for exactly the reason its docblock gives.
   *
   * The 3-minute window is enforced here exactly as `confirm()` enforces
   * it — expire first, then refuse the action — because without this check
   * a cashier could still reject an intent whose deadline had already
   * passed but that the expiry sweep hadn't reached yet: the row would end
   * up `REJECTED` by a decision made outside the window it was valid for,
   * instead of `EXPIRED` (docs/NEXT_CLAUDE_TASK.md requirement 11,
   * confirmed by independent audit — GitHub issue #28).
   */
  async reject(intentId: string, staffUserId: string, dto: RejectPurchaseIntentDto) {
    const intent = await this.findByIdOrThrow(intentId);
    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      return intent; // idempotent, same reasoning as confirm()
    }
    if (intent.expiresAt < new Date()) {
      await this.expireOne(intent);
      throw new BadRequestException('This purchase intent has expired');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseIntent.updateMany({
        where: { id: intentId, status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
        data: {
          status: PurchaseIntentStatus.REJECTED,
          rejectionReason: dto.comment ? `${dto.reasonCode}: ${dto.comment}` : dto.reasonCode,
          rejectedAt: new Date(),
        },
      });
      if (claimed.count === 0) return;

      if (intent.bonusReservationId) {
        await this.bonusEngine.releaseReservation(intent.bonusReservationId, 'partner_rejected', tx);
      }
      if (intent.sourceTransactionId) {
        await this.transactionsService.markFailed(intent.sourceTransactionId, 'partner_rejected', tx);
      }

      await this.auditService.record(
        {
          actorUserId: staffUserId,
          action: AuditAction.PURCHASE_INTENT_REJECTED,
          entityType: 'PurchaseIntent',
          entityId: intentId,
          metadata: { reason: dto.reasonCode },
        },
        tx,
      );
    });

    return this.findByIdOrThrow(intentId);
  }

  /** Spec §7: the 3-minute timeout, swept — see `sweeps.jobs.ts`. */
  async expireStale(): Promise<number> {
    const stale = await this.prisma.purchaseIntent.findMany({
      where: { status: PurchaseIntentStatus.AWAITING_CONFIRMATION, expiresAt: { lt: new Date() } },
    });
    let count = 0;
    for (const intent of stale) {
      if (await this.expireOne(intent)) count += 1;
    }
    return count;
  }

  /**
   * Same atomicity fix as `reject()`, for the sweep-driven expiry path —
   * see that method's docblock for the failure mode this closes.
   */
  private async expireOne(intent: { id: string; bonusReservationId: string | null; sourceTransactionId: string | null }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseIntent.updateMany({
        where: { id: intent.id, status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
        data: { status: PurchaseIntentStatus.EXPIRED },
      });
      if (claimed.count === 0) return false;

      if (intent.bonusReservationId) {
        await this.bonusEngine.releaseReservation(intent.bonusReservationId, 'purchase_intent_expired', tx);
      }
      if (intent.sourceTransactionId) {
        await this.transactionsService.markFailed(intent.sourceTransactionId, 'purchase_intent_expired', tx);
      }
      await this.auditService.record(
        {
          action: AuditAction.PURCHASE_INTENT_EXPIRED,
          entityType: 'PurchaseIntent',
          entityId: intent.id,
          metadata: {},
        },
        tx,
      );
      return true;
    });
  }
}
