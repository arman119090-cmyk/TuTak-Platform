import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  ContributionRuleKind,
  PaymentRoute,
  UnitOfMeasure,
  BonusEntryType,
  LedgerAccountType,
  PostingDirection,
  Prisma,
  PurchaseIntent,
  PurchaseIntentStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomInt, randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { MONEY_SCALE, parseMoney, parsePositiveMoney, roundCharge } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerBalanceService } from '../customer-balance/customer-balance.service';
import { MediaViewService } from '../media/media-view.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { DeferredBonusLotService } from '../wallet/deferred-bonus-lot.service';
import { LedgerService } from '../ledger/ledger.service';
import { contributionForPurchase } from '../partners/contribution/contribution-rule';
import { PartnerContributionRuleService } from '../partners/contribution/partner-contribution-rule.service';
import { PartnersService } from '../partners/partners.service';
import { MONEY_MAY_HAVE_MOVED } from '../psp/psp-attempt-safety';
import {
  CURRENT_REFERRAL_PROGRAM_VERSION,
  ReferralChainLevel,
  ReferralService,
} from '../referral/referral.service';
import { TransactionsService } from '../transactions/transactions.service';
import { WalletService } from '../wallet/wallet.service';
import { ApprovePurchaseIntentDto } from './dto/approve-purchase-intent.dto';
import { CreatePurchaseIntentDto } from './dto/create-purchase-intent.dto';
import { RejectPurchaseIntentDto } from './dto/reject-purchase-intent.dto';
import { PurchaseFundingService } from './purchase-funding.service';

type Tx = Prisma.TransactionClient;

/**
 * Who is agreeing to a purchase's economics: a member of staff at the till,
 * or the partner's own POS integration acting under its API key (brief §20,
 * 20.09.2026). Exactly one, never both — the database says the same.
 */
/** See `PurchaseIntentsService.create`. */
export interface CreatePurchaseIntentOptions {
  /** Runs inside the insert's transaction, after it; a throw rolls the purchase back. */
  bind?: (tx: Prisma.TransactionClient, intentId: string) => Promise<void>;
}

export type MerchantActor = { staffUserId: string } | { apiKeyId: string };

const toMerchantActor = (actor: string | MerchantActor): MerchantActor =>
  typeof actor === 'string' ? { staffUserId: actor } : actor;

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
 * Business rule (2026-08-16): `confirm()`/`reject()` — the manual
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
/**
 * Is this the unique violation that means "those four digits are taken"?
 *
 * `meta.target` is not one shape. Prisma reports a unique violation either
 * as the model's own field names (`['partnerId', 'confirmationCode']`) or
 * as the database's index name
 * (`purchase_intents_active_partner_confirmation_code_key`) depending on
 * what the driver could resolve — camelCase in one, snake_case in the
 * other, an array in one, a string in the other. Matching only the
 * snake_case index name is what let a real collision escape the retry loop
 * as a 500 (caught by CI on a 40-way concurrent allocation, where a
 * collision is roughly a one-in-thirteen event and so passes locally far
 * more often than it fails).
 *
 * Normalising away case and underscores matches both spellings and cannot
 * match a different constraint on this table.
 */
export function isConfirmationCodeCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.toLowerCase().replace(/_/g, '').includes('confirmationcode');
}

/**
 * Whether this is the database refusing a second unfinished purchase for the
 * same customer at the same business.
 *
 * Separate from `isConfirmationCodeCollision` and checked separately: a code
 * collision is retried by drawing another code, and retrying *this* one would
 * loop twelve times and then lie about why it failed.
 */
/**
 * The hold's ledger id is bookkeeping, not part of the purchase a client
 * sees. `prepaidAmountApplied` is; the transaction behind it is not.
 */
function withoutHoldId<T extends object>(row: T): Omit<T, 'prepaidHoldTransactionId'> {
  const { prepaidHoldTransactionId: _hold, ...rest } = row as T & {
    prepaidHoldTransactionId?: unknown;
  };
  return rest;
}

export function isLivePurchaseCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const text = (Array.isArray(target) ? target.join(',') : String(target ?? ''))
    .toLowerCase()
    .replace(/_/g, '');
  // Prisma reports a partial unique index either by its name or by the
  // columns it covers, depending on how it learned about it — and this index
  // is declared in SQL rather than in the schema, so in practice it is the
  // columns. Both spellings are accepted; nothing else in this table is
  // unique on that pair, so the column form cannot mean anything else.
  return (
    text.includes('onelivepercustomerpartner') ||
    (text.includes('customerid') && text.includes('partnerid'))
  );
}

/**
 * The refusal both halves of the one-live-purchase guard give.
 *
 * One sentence, one place: the server check and the database's own unique
 * violation are the same rule seen from two distances, and a customer who hit
 * the race should not get a different explanation from the one who did not.
 */
const ONE_LIVE_PURCHASE_MESSAGE =
  'You already have a purchase in progress at this business. Finish or cancel it ' +
  'before starting another';

/**
 * The per-unit line item on a purchase, if it has one.
 *
 * Returns the three columns together or nothing at all — `quantity` alone is
 * a receipt that cannot be re-derived, and the database says so too. The
 * cross-check against `grossAmount` is here because a till that sends
 * 50 L × 300 AMD and a gross of 14,000 has a bug, and storing both numbers
 * would leave two different answers to "what did this cost" on one row.
 */
function parseLineItem(
  dto: { quantity?: string; quantityUnit?: UnitOfMeasure; unitPrice?: string },
  grossAmount: Decimal,
): { quantity: Decimal; quantityUnit: UnitOfMeasure; unitPrice: Decimal } | null {
  const present = [dto.quantity, dto.quantityUnit, dto.unitPrice].filter(
    (v) => v !== undefined && v !== null && String(v).trim() !== '',
  );
  if (present.length === 0) return null;
  if (present.length !== 3) {
    throw new BadRequestException(
      'A per-unit purchase needs all of quantity, quantityUnit and unitPrice',
    );
  }

  const quantity = parsePositiveMoney(dto.quantity!, 'quantity');
  const unitPrice = parseMoney(dto.unitPrice!, 'unitPrice');
  if (unitPrice.lessThan(0)) throw new BadRequestException('unitPrice cannot be negative');

  // No trimming or blank check any more: the value is an enum, and
  // `class-validator` refused anything outside it before this ran.
  const quantityUnit = dto.quantityUnit!;

  if (!quantity.times(unitPrice).equals(grossAmount)) {
    throw new BadRequestException(
      `quantity × unitPrice (${quantity.times(unitPrice).toString()}) must equal ` +
        `grossAmount (${grossAmount.toString()})`,
    );
  }
  return { quantity, quantityUnit, unitPrice };
}

@Injectable()
export class PurchaseIntentsService {
  private readonly logger = new Logger(PurchaseIntentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly walletService: WalletService,
    private readonly partnersService: PartnersService,
    private readonly contributionRules: PartnerContributionRuleService,
    private readonly transactionsService: TransactionsService,
    private readonly referralService: ReferralService,
    private readonly deferredBonusLots: DeferredBonusLotService,
    private readonly ledger: LedgerService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly media: MediaViewService,
    private readonly customerBalance: CustomerBalanceService,
    private readonly funding: PurchaseFundingService,
  ) {}

  /**
   * `client` lets a caller already inside a transaction read on that
   * transaction's own connection instead of borrowing a second one from the
   * pool — see `postContributionLedger` for what borrowing costs under a
   * burst of duplicate provider callbacks.
   */
  async findByIdOrThrow(id: string, client: Tx | PrismaService = this.prisma) {
    const intent = await client.purchaseIntent.findUnique({ where: { id } });
    if (!intent) throw new NotFoundException('Purchase intent not found');
    return intent;
  }

  /**
   * `branchIds`, when non-null, restricts the result to those specific
   * branches — an empty array on purpose returns nothing, for the same
   * "unassigned staff sees nothing" reasoning `branchFilterFor` documents.
   * `null` (an owner/admin/all-branch caller) applies no branch filter at
   * all, matching this method's pre-branch-scoping behavior exactly.
   */
  listForPartner(partnerId: string, status?: PurchaseIntentStatus, branchIds?: string[] | null) {
    return this.prisma.purchaseIntent.findMany({
      where: {
        partnerId,
        ...(status ? { status } : {}),
        ...(branchIds ? { partnerBranchId: { in: branchIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A partner's own confirmed QR/PurchaseIntent activity, grouped by day —
   * the real-activity counterpart to `SettlementService.listForPartner`'s
   * daily rollup of the legacy card-payment pipeline.
   *
   * `Settlement` rows only ever exist for a captured `Payment` — the
   * card-charge path gated behind `CARD_PAYMENTS_ENABLED`, which stays off in
   * production (docs/LAUNCH_READINESS_2026-08-16.md). A partner running only the live QR flow
   * has confirmed purchases and a real `PARTNER_PAYABLE` balance, but zero
   * `Settlement` rows — so this reads the same source `postContributionLedger`
   * and `postRedemptionCompensation` already posted from, rather than adding
   * a third parallel rollup table.
   *
   * Two figures per day, matching doc §2's own worked example exactly:
   * `discountGivenAmount` is what `bonusAmountRequested` compensated the
   * partner for (TuTak's obligation), `commissionOwedAmount` is `poolAmount`
   * (the partner's commission obligation on the same purchase) — `net =
   * discount - commission`, positive in the partner's favor when the
   * discount they gave out exceeds what they owe in commission, exactly
   * doc §2's 5,000 − 1,200 = 3,800.
   *
   * Deliberately scoped to purchases where *this* partner is the merchant —
   * not purchases where this partner was paid a referral share as the
   * terminal link in another purchase's chain (`postContributionLedger`'s
   * `partnerReferrerPostings`). That is real income too, but it lives on a
   * different partner's `PurchaseIntent` rows and has no `grossAmount` of
   * its own to report against; folding it into "this partner's daily
   * activity" would make the gross/discount/commission figures not add up
   * to any single purchase a reader could look up. It still shows up in the
   * partner's own `PARTNER_PAYABLE` balance and payout history — just not
   * itemised in this table. Left out of this pass for that reason, not
   * because it doesn't matter.
   *
   * Aggregated in application code rather than a SQL `GROUP BY` on a
   * truncated date: nothing else in this codebase groups by day that way
   * either (`SettlementService` maintains a running total per calendar day
   * as each payment settles, rather than aggregating historical rows), and a
   * partner's confirmed-purchase volume is nowhere near the scale where a
   * bounded window of rows read into memory would be the wrong call.
   */
  async dailyActivityForPartner(partnerId: string, days = 30, branchIds?: string[] | null) {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const intents = await this.prisma.purchaseIntent.findMany({
      where: {
        partnerId,
        status: PurchaseIntentStatus.CONFIRMED,
        confirmedAt: { gte: since },
        ...(branchIds ? { partnerBranchId: { in: branchIds } } : {}),
      },
      select: {
        confirmedAt: true,
        grossAmount: true,
        bonusAmountRequested: true,
        poolAmount: true,
      },
      orderBy: { confirmedAt: 'desc' },
    });

    interface DayTotals {
      periodStart: string;
      grossAmount: Decimal;
      discountGivenAmount: Decimal;
      commissionOwedAmount: Decimal;
      purchaseCount: number;
    }

    const byDay = new Map<string, DayTotals>();
    for (const intent of intents) {
      // `confirmedAt` is set in the same transaction as `status: CONFIRMED`
      // (see `settlePurchase`), so a row selected above always has one.
      const at = intent.confirmedAt!;
      const key = new Date(
        Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
      ).toISOString();

      const existing = byDay.get(key) ?? {
        periodStart: key,
        grossAmount: new Decimal(0),
        discountGivenAmount: new Decimal(0),
        commissionOwedAmount: new Decimal(0),
        purchaseCount: 0,
      };
      existing.grossAmount = existing.grossAmount.plus(intent.grossAmount);
      existing.discountGivenAmount = existing.discountGivenAmount.plus(intent.bonusAmountRequested);
      existing.commissionOwedAmount = existing.commissionOwedAmount.plus(intent.poolAmount ?? 0);
      existing.purchaseCount += 1;
      byDay.set(key, existing);
    }

    return Array.from(byDay.values())
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
      .map((day) => ({
        periodStart: day.periodStart,
        grossAmount: day.grossAmount.toFixed(MONEY_SCALE),
        discountGivenAmount: day.discountGivenAmount.toFixed(MONEY_SCALE),
        commissionOwedAmount: day.commissionOwedAmount.toFixed(MONEY_SCALE),
        netAmount: day.discountGivenAmount.minus(day.commissionOwedAmount).toFixed(MONEY_SCALE),
        purchaseCount: day.purchaseCount,
      }));
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
  async toDto<
    T extends {
      partnerId: string;
      brandDisplayName: string | null;
      brandLogoAssetId: string | null;
    },
  >(intent: T) {
    const { brandDisplayName: _name, brandLogoAssetId: _asset, ...rest } = intent;
    const brand = await this.media.brandFor(intent);
    return { ...withoutHoldId(rest), partnerBrand: brand! };
  }

  async toDtos<
    T extends {
      partnerId: string;
      brandDisplayName: string | null;
      brandLogoAssetId: string | null;
    },
  >(intents: T[]) {
    const brands = await this.media.brandsFor(intents);
    return intents.map((intent) => {
      const { brandDisplayName: _name, brandLogoAssetId: _asset, ...rest } = intent;
      return { ...withoutHoldId(rest), partnerBrand: brands.get(intent)! };
    });
  }

  /**
   * Spec §7 steps 1-8: resolve the partner/branch, snapshot its commercial
   * terms, reserve the requested bonus, and open the confirmation window.
   * No financial ledger entry exists yet — spec §7 step 11 is explicit that
   * those wait for confirmation.
   */
  /**
   * Opens a purchase.
   *
   * `opts.bind` (audit 21.09.2026, D10) runs inside the same transaction as
   * the insert, after it, and is what a caller that owns a durable identity
   * — a POS checkout — uses to tie that identity to this purchase. Either
   * both the purchase and the binding commit, or neither: there is no
   * moment where a purchase exists without its checkout knowing, which is
   * the moment a second customer could claim the same till sale.
   */
  async create(dto: CreatePurchaseIntentDto, customerId: string, opts: CreatePurchaseIntentOptions = {}) {
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

    const paymentRoute = dto.paymentRoute ?? PaymentRoute.DIRECT_PARTNER;
    if (
      paymentRoute === PaymentRoute.TUTAK_PSP &&
      !this.config.get('features.tutakPspEnabled', { infer: true })
    ) {
      throw new BadRequestException('Paying inside TuTak is not available yet');
    }

    await this.assertNoUnresolvedPayment(customerId, partner.id);

    /*
     * A purchase names the branch it happened at whenever the partner has
     * one to name.
     *
     * This used to read `partner.category === 'fuel'`, because branch
     * scoping arrived with the fuel-station work and a station's branches
     * sell non-interchangeable products. But the property has nothing to do
     * with fuel: it is that a partner with locations has branch-scoped staff,
     * and a branch-less row is then in an unreachable state that three
     * separate mechanisms describe differently.
     *
     *  - `branchFilterFor` builds `{ partnerBranchId: { in: [...] } }`, and
     *    SQL's `IN` never matches NULL — the purchase appears in no
     *    branch-scoped queue at all.
     *  - `assertResourceBranchScope` skips the branch check when the branch
     *    is null — so that same purchase is confirmable by *any* of the
     *    partner's staff, a cashier from another branch included, via the
     *    till-code lookup that does not need the queue.
     *  - `Transaction.partnerBranchId` stays null, so the takings land in
     *    the partner's totals and in no branch's.
     *
     * Invisible where it should be listed, reachable where it should not be,
     * and attributed nowhere. Requiring the branch is what makes "what this
     * cashier may confirm" and "what this cashier can see" the same set.
     *
     * Only *active* branches count. A restaurant that closed its one
     * location is a business with nowhere to walk into, and `create` already
     * refuses a named branch that is closed — demanding one here as well
     * would leave it unable to trade at all.
     *
     * `fuel` keeps its own floor on top of that, rather than being folded
     * into the general rule and quietly loosened: a station that has not
     * created its branch rows yet used to be unable to take a purchase at
     * all, and that is deliberate — which product a station sells is a
     * per-branch fact (`PartnerBranch.fuelType`), so a station with no
     * branches has nowhere to record what was actually bought. The general
     * rule below would have let it trade branch-lessly.
     *
     * The count runs only when no branch was given, so the ordinary path —
     * a scanned branch QR, which always carries one — pays nothing for it.
     */
    if (!dto.partnerBranchId) {
      const openBranches = await this.prisma.partnerBranch.count({
        where: { partnerId: partner.id, isActive: true },
      });
      if (openBranches > 0 || partner.category === 'fuel') {
        // Names the way out, not just the refusal. The one way to reach this
        // with a real partner is scanning a whole-business code printed
        // before the business had locations; the code at the till is the
        // branch one, and that is what the customer needs to be told.
        throw new BadRequestException(
          'Select which branch this purchase is at, or scan the code displayed at this location',
        );
      }
    }

    if (dto.partnerBranchId) {
      const branch = await this.prisma.partnerBranch.findUnique({
        where: { id: dto.partnerBranchId },
      });
      if (!branch || branch.partnerId !== partner.id) {
        throw new BadRequestException('This branch does not belong to the given partner');
      }
      if (!branch.isActive) {
        throw new BadRequestException('This branch is not currently open');
      }
    }

    // Spec §11: max_bonus_payment_percent is the partner's own ceiling —
    // technically supports up to 100% if the partner permits it and the
    // customer has enough available bonus (the latter is enforced by
    // `bonusEngine.reserve` itself, which throws on insufficient balance).
    const maxUsable = roundCharge(grossAmount.times(partner.maxBonusPaymentPercent).dividedBy(100));
    if (bonusAmountRequested.greaterThan(maxUsable)) {
      throw new BadRequestException(
        `This partner allows at most ${partner.maxBonusPaymentPercent}% of the purchase to be paid with bonus`,
      );
    }

    const lineItem = parseLineItem(dto, grossAmount);
    const rule = await this.contributionRules.liveRule(partner.id);

    /*
     * A per-unit partner needs to know what was sold.
     *
     * Refused here rather than at confirmation because the customer is still
     * standing at the pump: "how many litres" is answerable now and not in
     * three minutes. The database refuses the same combination as a last
     * resort (`purchase_intent_rule_snapshot_matches`), but a constraint name
     * is not something to show a customer.
     */
    if (
      rule &&
      rule.kind !== ContributionRuleKind.PERCENT_BPS &&
      (!lineItem || lineItem.quantityUnit !== rule.unit)
    ) {
      throw new BadRequestException(
        `This business prices per ${rule.unit}; the purchase must say how many were sold`,
      );
    }

    /*
     * The hybrid split (20.09.2026): what the customer's own stored money
     * covers, checked by the same rule set the checkout quote ran a moment
     * ago. Refused here on message; guaranteed below by the hold, which is
     * the atomic check. Zero — and everything exactly as before — for every
     * client that does not send it.
     */
    const { prepaidAmountApplied, ordinaryPaymentRemainder } = await this.funding.components({
      customerId,
      partnerId: partner.id,
      grossAmount: dto.grossAmount,
      bonusAmountRequested: dto.bonusAmountRequested,
      prepaidAmountApplied: dto.prepaidAmountApplied,
      paymentRoute,
    });
    const intentTimeoutSeconds = this.config.get('purchasePolicy.intentTimeoutSeconds', {
      infer: true,
    });

    const transaction = await this.transactionsService.create({
      userId: customerId,
      partnerId: partner.id,
      // The one place a branch is known at the moment a transaction is
      // written. Carried onto the transaction itself so branch-scoped reads
      // (history, analytics) can filter in SQL rather than by walking back
      // through the intent — see `Transaction.partnerBranchId`.
      partnerBranchId: dto.partnerBranchId,
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

      /*
       * The hold and the row are one transaction. A purchase that names a
       * prepaid amount exists only if the money was actually spoken for,
       * and money is spoken for only if the purchase exists — the database
       * says the same (`purchase_intents_prepaid_hold_matches_amount`). The
       * id is drawn up front so the hold's ledger posting can name the
       * purchase it belongs to before the row is written.
       */
      const intentId = randomUUID();
      const intent = await this.createWithConfirmationCode(
        {
          id: intentId,
          customerId,
          partnerId: partner.id,
          partnerBranchId: dto.partnerBranchId,
          grossAmount,
          bonusAmountRequested,
          prepaidAmountApplied,
          ordinaryPaymentRemainder,
          paymentRoute,
          ...lineItem,
          // The terms this purchase is priced under, named exactly and by
          // version. `negotiatedRateBps` is still written below — it is what
          // a purchase with no rule falls back to, and leaving it out would
          // make the two paths differ in more than the arithmetic.
          contributionRuleId: rule?.id ?? null,
          contributionRuleVersion: rule?.version ?? null,
          contributionRuleKind: rule?.kind ?? null,
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
        {
          fund: prepaidAmountApplied.greaterThan(0)
            ? async (tx) => {
                const hold = await this.customerBalance.holdForPurchase(
                  { userId: customerId, amount: prepaidAmountApplied, purchaseIntentId: intentId },
                  tx,
                );
                return { prepaidHoldTransactionId: hold.id };
              }
            : undefined,
          /*
           * The audit row and the caller's binding travel in the insert's
           * own transaction (audit 21.09.2026, D18). They used to run after
           * it, and an audit INSERT failing *after* the purchase had
           * committed fell into the catch below — which released the bonus
           * reservation and failed the source transaction of a purchase that
           * was, in fact, live. Now a failure here rolls the purchase back
           * with it, and the compensation below only ever runs when nothing
           * was committed.
           */
          afterInsert: async (tx, created) => {
            await this.auditService.record(
              {
                actorUserId: customerId,
                action: AuditAction.PURCHASE_INTENT_CREATED,
                entityType: 'PurchaseIntent',
                entityId: created.id,
                metadata: {
                  partnerId: partner.id,
                  grossAmount: grossAmount.toString(),
                  bonusAmountRequested: bonusAmountRequested.toString(),
                  prepaidAmountApplied: prepaidAmountApplied.toString(),
                  externalAmountDue: ordinaryPaymentRemainder.toString(),
                  paymentRoute,
                  contributionRuleVersion: rule?.version ?? null,
                  contributionRuleKind: rule?.kind ?? null,
                },
              },
              tx,
            );
            if (opts.bind) await opts.bind(tx, created.id);
          },
        },
      );

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
   * Refuse to start a new purchase at a business where this customer already
   * has one whose money may have moved.
   *
   * ## The failure this closes
   *
   * Found in the product review of 15.09.2026, and it is a cross-purchase
   * failure, which is why no amount of care inside a single purchase
   * prevents it:
   *
   * 1. The customer opens purchase A and picks `TUTAK_PSP`. The provider
   *    bill opens. The customer pays, or does not — nobody here knows yet.
   * 2. Nothing conclusive arrives. A's attempt sits `INITIATED`, or is swept
   *    to `EXPIRED`, which is **not** a synonym for "no money moved".
   * 3. The customer, seeing no confirmation, pays the cashier in cash. The
   *    cashier opens purchase B and confirms it. B settles cleanly.
   * 4. The provider's confirmation for A arrives late.
   *
   * After step 4 the customer has paid for one meal twice. `settleFrom-
   * ProviderConfirmation` stops A being *settled* twice — A is its own
   * purchase and B is its own purchase, so each settles exactly once, and
   * that is precisely the problem: two correct settlements for one meal.
   *
   * ## Why the check is here and not at confirmation
   *
   * Because by confirmation time the money is already gone. The only moment
   * at which the second purchase can still be prevented is before it exists,
   * and the only thing that can prevent it is knowing the first one is
   * unresolved.
   *
   * ## What counts as unresolved
   *
   * `MONEY_MAY_HAVE_MOVED` in `PspPaymentService` is the same list, and it
   * is deliberately generous: everything except `FAILED`, the one status the
   * provider states authoritatively. An attempt this customer abandoned two
   * days ago still blocks, and that is the correct trade — a customer who
   * cannot buy is inconvenienced, a customer charged twice is robbed. The
   * way out is resolving the old attempt, not ignoring it.
   *
   * Scoped to the same partner, not globally: two unrelated businesses are
   * two unrelated purchases, and blocking the second would be punishing the
   * customer for an unrelated provider's silence.
   */
  /**
   * Whether a provider may be holding this purchase's money.
   *
   * Reads the attempt table directly rather than calling `PspPaymentService`:
   * `PspModule` imports this module, so injecting it back would be a cycle.
   * `MONEY_MAY_HAVE_MOVED` is shared between the two so the two readings
   * cannot drift.
   */
  private async hasUnsafePspAttempt(intentId: string, tx?: Tx): Promise<boolean> {
    const db = tx ?? this.prisma;
    const count = await db.pspPaymentAttempt.count({
      where: { purchaseIntentId: intentId, status: { in: [...MONEY_MAY_HAVE_MOVED] } },
    });
    return count > 0;
  }

  private async assertNoUnresolvedPayment(customerId: string, partnerId: string): Promise<void> {
    // (a) Another purchase is simply still in flight. Route-independent, and
    // checked first because it is the common case and the cheaper query.
    const live = await this.prisma.purchaseIntent.findFirst({
      where: { customerId, partnerId, status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
      select: { id: true, paymentRoute: true },
    });
    if (live) {
      this.logger.warn(
        `Refusing a new purchase for customer ${customerId} at partner ${partnerId}: ` +
          `intent ${live.id} (${live.paymentRoute}) is still awaiting confirmation`,
      );
      throw new ConflictException(ONE_LIVE_PURCHASE_MESSAGE);
    }

    // (b) No purchase is in flight, but a provider may still be holding money
    // from one that is over. An EXPIRED purchase whose attempt timed out is
    // exactly this: final on our side, unresolved on theirs.
    const blocking = await this.prisma.pspPaymentAttempt.findFirst({
      where: {
        status: { in: [...MONEY_MAY_HAVE_MOVED] },
        purchaseIntent: { customerId, partnerId },
      },
      select: { id: true, status: true, purchaseIntentId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!blocking) return;

    this.logger.warn(
      `Refusing a new purchase for customer ${customerId} at partner ${partnerId}: ` +
        `attempt ${blocking.id} on intent ${blocking.purchaseIntentId} is ${blocking.status}`,
    );
    throw new ConflictException(
      'An earlier payment at this business has not finished. Wait for it to settle, ' +
        'or ask staff to resolve it, before starting a new purchase',
    );
  }

  /**
   * Creates the intent with a four-digit code the till can use to find it.
   *
   * The code is allocated by *trying* it: a random draw, then the insert,
   * and on the database's unique-violation another draw. Reading the taken
   * codes first and picking a free one would be a check-then-act with a
   * window between the two, and two customers at the same business in the
   * same instant would both be told the same four digits. Here the index is
   * the allocator — the only way to hold a code is to own the row that has
   * it, and only one insert can win.
   *
   * Twelve attempts: with a three-minute window, the number of purchases a
   * single business can have awaiting confirmation at once is in the tens,
   * so the chance of even one collision is small and of twelve in a row
   * vanishing. Exhausting them is a real (if practically unreachable)
   * capacity limit, not a request error — hence 503 and "try again", which
   * is exactly what a customer's retry does.
   */
  /**
   * `fund`, when given, runs inside a transaction with the insert and its
   * result is merged into the row — the prepaid hold. The whole transaction
   * is retried on a code collision rather than the insert alone, because a
   * unique violation aborts a PostgreSQL transaction outright: there is no
   * "try another code" inside one. Retrying the hold with it costs one
   * cheap posting on the rare collision and keeps the invariant that a
   * purchase and its hold are written together or not at all. Without
   * `fund` the insert runs on the plain client, exactly as it always has.
   */
  private async createWithConfirmationCode(
    data: Omit<Prisma.PurchaseIntentUncheckedCreateInput, 'confirmationCode'>,
    hooks: {
      fund?: (tx: Tx) => Promise<Partial<Prisma.PurchaseIntentUncheckedCreateInput>>;
      /** Runs after the insert, in the same transaction; a throw rolls the purchase back. */
      afterInsert?: (tx: Tx, created: PurchaseIntent) => Promise<void>;
    } = {},
  ) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      // `randomInt` and not `Math.random`: the code is not a secret, but it
      // is read aloud in a shop, and a predictable sequence would let one
      // customer guess the code of the person ahead of them in the queue.
      // `padStart` is what keeps 0042 from becoming 42 — see the column's
      // own note on why this is Char(4).
      const confirmationCode = String(randomInt(0, 10_000)).padStart(4, '0');
      try {
        // Always a transaction, even without `fund`: the audit row and a
        // caller's binding commit with the row or not at all (D18/D10).
        return await this.prisma.$transaction(async (tx) => {
          const funded = hooks.fund ? await hooks.fund(tx) : {};
          const created = await tx.purchaseIntent.create({ data: { ...data, ...funded, confirmationCode } });
          if (hooks.afterInsert) await hooks.afterInsert(tx, created);
          return created;
        });
      } catch (error) {
        // Two creates raced past the service check and the database arbitrated.
        // Not retryable — drawing a different code changes nothing about the
        // fact that this customer already has a purchase open here.
        if (isLivePurchaseCollision(error)) throw new ConflictException(ONE_LIVE_PURCHASE_MESSAGE);
        if (!isConfirmationCodeCollision(error)) throw error;
        // Someone else holds that code right now. Draw again.
      }
    }
    throw new ServiceUnavailableException(
      'Could not allocate a purchase code just now — please try again',
    );
  }

  /**
   * The till's way in: the customer reads out four digits, the cashier types
   * them, and this returns the one live purchase they belong to.
   *
   * Scoped to the partner by the caller (`assertPartnerScope`) and to the
   * branch by the caller too (`assertResourceBranchScope` on the row this
   * returns) — a code is a disambiguator, and it grants nothing on its own.
   * Only `AWAITING_CONFIRMATION` rows are searched, which is both what the
   * cashier means and what the partial unique index makes unambiguous: a
   * resolved purchase releases its code, so an old slip cannot resurface
   * someone else's purchase.
   */
  async findActiveByCode(partnerId: string, confirmationCode: string) {
    const intent = await this.prisma.purchaseIntent.findFirst({
      where: {
        partnerId,
        confirmationCode,
        status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
      },
    });
    if (!intent) {
      throw new NotFoundException('No purchase is waiting for that code');
    }
    return intent;
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
  /**
   * Somebody at the business agrees to what is being sold, before any bill is
   * opened at the provider.
   *
   * ## What this exists to stop
   *
   * The provider confirms that money moved. It does not, and cannot, confirm
   * that a sale happened — and on this platform the customer supplies the
   * gross, the quantity and the unit price when they open a purchase. Without
   * a merchant in the loop, a customer types 500 litres at a real fuel
   * station, pays the resulting bill through Idram, and one verified callback
   * credits the partner's `PARTNER_PAYABLE`, mints the customer's own
   * cashback and pays their referral chain on a sale that never happened. The
   * provider did nothing wrong: the money genuinely moved.
   *
   * ## What approval means, by route
   *
   *  - `TUTAK_PSP`: this authorises the bill and nothing else. The purchase
   *    is completed by the provider's verified callback, and by nothing else.
   *  - `DIRECT_PARTNER`: `confirm()` does this on the way past, because a
   *    cashier taking cash is approving the economics and stating that the
   *    money is in the till in one act.
   *
   * For an integrated POS or pump this is the seam where an authoritative
   * integration event belongs instead of a person. `PartnerIntegration` is a
   * registry with no event path today, so that is deliberately not built
   * rather than stubbed.
   *
   * ## Why the cashier types the numbers back
   *
   * For `FIXED_PER_UNIT` and `HYBRID` terms the platform's own share is
   * `quantity × margin`, so the quantity is not a detail on the receipt, it
   * is the price of the sale. A confirm button next to a number nobody read
   * is not approval of that number. The echoed values are compared to the
   * stored snapshot and a mismatch is refused.
   */
  async approveForPayment(intentId: string, staffUserId: string, dto: ApprovePurchaseIntentDto) {
    const intent = await this.findByIdOrThrow(intentId);
    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      throw new ConflictException(`This purchase is ${intent.status}`);
    }
    if (intent.paymentRoute !== PaymentRoute.TUTAK_PSP) {
      // A direct purchase is approved by confirming it — there is no separate
      // step, and offering one would leave staff wondering which they owe.
      throw new ConflictException(
        'This purchase is paid at the till; confirm it when you take the money',
      );
    }
    if (intent.merchantApprovedAt) {
      return intent; // idempotent: the same approval twice is one approval
    }
    if (intent.expiresAt < new Date()) {
      await this.expireOne(intent);
      throw new BadRequestException('This purchase intent has expired');
    }

    await this.stampMerchantApproval(intent, staffUserId, dto);

    await this.auditService.record({
      actorUserId: staffUserId,
      action: AuditAction.PURCHASE_INTENT_CONFIRMED,
      entityType: 'PurchaseIntent',
      entityId: intentId,
      metadata: {
        event: 'purchase_intent.merchant_approved',
        partnerId: intent.partnerId,
        grossAmount: intent.grossAmount.toString(),
        quantity: intent.quantity?.toString() ?? null,
        quantityUnit: intent.quantityUnit,
      },
    });
    return this.findByIdOrThrow(intentId);
  }

  /**
   * Check what the member of staff read back, then freeze the snapshot.
   *
   * Shared by both routes on purpose: the line item a cashier has to have
   * seen is the same line item whichever way the money arrives, and having
   * one copy of that check is what stops the two drifting.
   */
  private async stampMerchantApproval(
    intent: {
      id: string;
      grossAmount: Decimal;
      quantity: Decimal | null;
      quantityUnit: UnitOfMeasure | null;
      unitPrice: Decimal | null;
      contributionRuleKind: ContributionRuleKind | null;
      merchantApprovedAt: Date | null;
    },
    actor: string | MerchantActor,
    dto: ApprovePurchaseIntentDto,
  ): Promise<void> {
    if (intent.merchantApprovedAt) return;
    const merchant = toMerchantActor(actor);

    const perUnit =
      intent.contributionRuleKind === ContributionRuleKind.FIXED_PER_UNIT ||
      intent.contributionRuleKind === ContributionRuleKind.HYBRID;

    if (perUnit) {
      if (!dto.quantity || !dto.quantityUnit || !dto.unitPrice) {
        throw new BadRequestException(
          'This business is paid per unit — confirm the quantity, the unit and the unit price',
        );
      }
      const quantity = parseMoney(dto.quantity, 'quantity');
      const unitPrice = parseMoney(dto.unitPrice, 'unitPrice');

      if (
        intent.quantity === null ||
        intent.unitPrice === null ||
        !quantity.equals(intent.quantity) ||
        !unitPrice.equals(intent.unitPrice) ||
        dto.quantityUnit !== intent.quantityUnit
      ) {
        throw new BadRequestException(
          `That does not match the purchase: it says ${intent.quantity?.toString() ?? '—'} ` +
            `${intent.quantityUnit ?? '—'} at ${intent.unitPrice?.toString() ?? '—'}. ` +
            'If the customer entered the wrong figures, reject this purchase and start again.',
        );
      }
      // The arithmetic is checked at creation too. Re-checked here because
      // this is the moment a human is vouching for it, and a snapshot that
      // does not multiply out is one nobody should be asked to vouch for.
      if (!quantity.times(unitPrice).equals(intent.grossAmount)) {
        throw new BadRequestException(
          `${quantity.toString()} × ${unitPrice.toString()} is not ${intent.grossAmount.toString()}`,
        );
      }
    }

    if (dto.grossAmount) {
      const gross = parseMoney(dto.grossAmount, 'grossAmount');
      if (!gross.equals(intent.grossAmount)) {
        throw new BadRequestException(
          `That does not match the purchase: it says ${intent.grossAmount.toString()}`,
        );
      }
    }

    const claimed = await this.prisma.purchaseIntent.updateMany({
      where: { id: intent.id, merchantApprovedAt: null },
      data: {
        ...('staffUserId' in merchant
          ? { merchantApprovedByUserId: merchant.staffUserId }
          : { merchantApprovedByApiKeyId: merchant.apiKeyId }),
        merchantApprovedAt: new Date(),
        merchantApprovalNote:
          dto.note ??
          (perUnit
            ? `${dto.quantity} ${dto.quantityUnit} × ${dto.unitPrice} = ${intent.grossAmount.toString()}`
            : null),
      },
    });
    if (claimed.count === 0) {
      // Somebody approved it between the read and this write. Their approval
      // is as good as this one would have been, so this is not an error.
      this.logger.warn(`Purchase ${intent.id} was approved concurrently; keeping the first`);
    }
  }

  /**
   * The cashier takes the money and confirms the sale — one act, as it always
   * was.
   *
   * `dto` is what they read back off the pump or the till. Empty for a
   * percentage partner, where there is no line item to check and demanding
   * one would train staff to type numbers they never looked at. Required for
   * `FIXED_PER_UNIT` and `HYBRID` terms, where the quantity *is* the price of
   * the sale — see `stampMerchantApproval`.
   */
  async confirm(
    intentId: string,
    actor: string | MerchantActor,
    dto: ApprovePurchaseIntentDto = {},
  ) {
    const merchant = toMerchantActor(actor);
    const staffUserId = 'staffUserId' in merchant ? merchant.staffUserId : null;
    const intent = await this.findByIdOrThrow(intentId);

    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      return intent; // already resolved — idempotent, not an error
    }

    /*
     * One purchase, one money route.
     *
     * A purchase routed through a payment provider is never collected at the
     * till, however plausible the reason looks to the person standing there:
     * "the app is stuck, just pay me cash" is exactly the sequence that ends
     * with the provider's callback arriving ten minutes later and the
     * customer having paid twice.
     *
     * Checked here rather than only in `PspPaymentService` because this is
     * the path a human actually takes. The database enforces the other half —
     * a provider attempt cannot exist on a direct purchase at all.
     */
    if (intent.paymentRoute !== PaymentRoute.DIRECT_PARTNER) {
      throw new ConflictException(
        'This purchase is being paid through a payment provider and must not be ' +
          'collected at the till. If the provider payment failed, the customer starts ' +
          'a new purchase.',
      );
    }
    if (intent.expiresAt < new Date()) {
      await this.expireOne(intent);
      throw new BadRequestException('This purchase intent has expired');
    }

    /*
     * A cashier's confirmation on a direct purchase *is* the merchant
     * approval — they are looking at the same screen and agreeing to the same
     * economics; the only difference from the provider route is that they are
     * also saying the money is in the till. Stamped here rather than made a
     * separate call so the direct flow keeps working exactly as it did, which
     * the product decision requires.
     *
     * Before `settlePurchase`, because the freeze trigger fires on the update
     * that sets these columns and would otherwise have to run against a row
     * mid-settlement. The line item is checked the same way `approveFor-
     * Payment` checks it — a per-unit partner's cashier confirms the quantity
     * whichever route the money takes.
     */
    await this.stampMerchantApproval(intent, merchant, dto);

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
      metadata: {
        partnerId: intent.partnerId,
        grossAmount: intent.grossAmount.toString(),
        ...('apiKeyId' in merchant ? { via: 'pos', apiKeyId: merchant.apiKeyId } : {}),
      },
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
  /**
   * Finishes a purchase whose money arrived through a payment provider.
   *
   * The provider's cash leg is posted by `PspPaymentService` in the same
   * transaction it passes in here, so the two commit together. Before this
   * existed, a verified provider payment moved the cash and left the purchase
   * itself unconfirmed: no points accrued, no referral paid, no commission
   * posted, and an intent still sitting in AWAITING_CONFIRMATION that a
   * cashier could then be asked to confirm. Found by the product review of the
   * branch, and it is the worst class of bug this system can have — money
   * moved, economics did not.
   *
   * Returns `already-resolved` when the purchase was settled by an earlier
   * delivery of the same callback, which is a normal outcome, not an error.
   */
  async settleFromProviderConfirmation(
    intentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<'settled' | 'already-resolved'> {
    const intent = await this.findByIdOrThrow(intentId, tx);
    if (intent.status === PurchaseIntentStatus.CONFIRMED) {
      return 'already-resolved';
    }
    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      /*
       * Money arrived for a purchase that was closed without it.
       *
       * This should be unreachable: `purchase_intent_not_abandoned_while_
       * paying` refuses EXPIRED, CANCELLED and REJECTED while an attempt is
       * unresolved, and an attempt being confirmable means exactly that. If
       * it happens anyway, an invariant has broken, and the honest response
       * is to refuse the whole transaction — the ledger posting and this
       * settlement roll back together — and page somebody, rather than
       * capture the money against a dead purchase and return quietly.
       */
      this.logger.error(
        `Provider confirmed payment for purchase ${intentId}, which is ${intent.status}. ` +
          'Nothing was settled. This is an invariant violation, not a race.',
      );
      throw new ConflictException(
        `Purchase is ${intent.status} but the provider confirmed payment — not settled, needs investigation`,
      );
    }
    return this.settlePurchase(intent, null, tx);
  }

  /**
   * Everything a confirmed purchase means, in one transaction.
   *
   * Called by both routes and deliberately unaware of which: the cashier's
   * confirmation and a verified provider callback produce identical loyalty
   * economics, and the only difference between them is who handed over the
   * cash — which is recorded elsewhere. Duplicating this for the provider
   * path would have been two implementations of the same rules, drifting.
   *
   * `externalTx` is how the provider route gets atomicity across both halves.
   * The provider's cash leg and this settlement have to commit together or
   * not at all; a partial state would be a customer charged for a purchase
   * that never accrued their points. Passing the caller's transaction is what
   * makes "both or neither" true rather than aspirational.
   *
   * `staffUserId` is null for a provider confirmation. Nobody at the partner
   * confirmed it, and recording a person who did not act would be a lie in
   * the audit trail.
   */
  private async settlePurchase(
    intent: Awaited<ReturnType<typeof this.findByIdOrThrow>>,
    staffUserId: string | null,
    externalTx?: Prisma.TransactionClient,
  ): Promise<'settled' | 'already-resolved'> {
    // Spec §12: the pool is computed from the terms this purchase was
    // *snapshotted* under — not from whatever the partner's terms are today.
    //
    // Since 15.09.2026 that snapshot can be a per-unit rule (HAZE: 10 AMD of
    // every litre) rather than a percentage, and this line is the **only**
    // place that difference exists. Everything below — the split into green,
    // deferred and three referrer legs, the debit to `PARTNER_PAYABLE`, the
    // refund reversal — takes `pool` and never asks how it was arrived at.
    // That was the explicit product decision: a new pricing shape must not
    // duplicate the ledger economics.
    /*
     * Everything this method reads before opening (or joining) a transaction
     * goes through `reader`, which is the caller's transaction when there is
     * one. A provider settlement calls this from *inside* an already-open
     * transaction, and a read on `this.prisma` there takes a second
     * connection out of the same pool while the first is still held. Five
     * duplicate callbacks did that at once, the pool had five connections,
     * and all five transactions sat waiting for a sixth until Prisma's 5s
     * interactive-transaction timeout killed every one of them — nothing
     * settled, where exactly one settlement was required.
     */
    const reader: Tx | PrismaService = externalTx ?? this.prisma;

    const pool = await this.contributionFor(intent, reader);

    // Read-only, and safe to resolve before the transaction: attribution is
    // immutable once created (spec §5) at every level, so the chain cannot
    // change between this read and the transaction below using it. The
    // 2026-08-22 3-level rework's own single source of truth for the split —
    // see `ReferralService.computePoolSplit`'s docblock for why `tutak` is
    // always the residual, never independently rounded, so all six legs
    // always sum to exactly `pool`.
    const chain = await this.referralService.resolveReferralChain(intent.customerId, reader);
    const split = this.referralService.computePoolSplit(pool, chain);
    const { green, deferred, l1, l2, l3, tutak } = split;
    const l1Entry = chain.find((c) => c.level === 1) ?? null;
    const l2Entry = chain.find((c) => c.level === 2) ?? null;
    const l3Entry = chain.find((c) => c.level === 3) ?? null;

    const run = async (tx: Prisma.TransactionClient) => {
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

      await this.postContributionLedger(
        intent,
        { pool, green, deferred, l1, l2, l3, tutak, chain },
        tx,
      );

      if (intent.bonusAmountRequested.greaterThan(0)) {
        await this.postRedemptionCompensation(intent, tx);
      }

      /*
       * The prepaid component: the money held at creation is now owed to
       * the partner. This is the *only* posting the funding split adds to a
       * confirmation — bonus already posts its compensation above, and what
       * the customer paid at the till or through the provider is not TuTak's
       * money and posts nothing here. Everything else on this path (pool,
       * cashback, deferred lot, referrers, contribution) is identical
       * whichever way the purchase was funded, which is the whole point.
       */
      if (intent.prepaidAmountApplied.greaterThan(0)) {
        await this.customerBalance.settleHoldToPartner(
          {
            userId: intent.customerId,
            partnerId: intent.partnerId,
            amount: intent.prepaidAmountApplied,
            purchaseIntentId: intent.id,
          },
          tx,
        );
      }

      return 'settled' as const;
    };

    try {
      return externalTx ? await run(externalTx) : await this.prisma.$transaction(run);
    } catch (err) {
      // Nothing to unwind by hand: the transaction above is one atomic
      // unit, so a failure anywhere in it rolled back the status claim
      // together with the reservation settle, the accrual, the deferred
      // lot and both ledger postings. The caller sees the error and the
      // intent is left safely retryable.
      this.logger.error(
        `Purchase intent ${intent.id} settlement failed and was rolled back: ${err}`,
      );
      throw err;
    }
  }

  /**
   * TuTak's share of this purchase, under the terms it was priced at.
   *
   * Reads the rule row the purchase *names*, never the partner's current
   * terms: a contract renegotiated this morning must not change what last
   * week's receipt says. The rule is immutable and never deleted, so the row
   * read here is byte-for-byte the row that was read at creation.
   *
   * A purchase with no rule snapshot — every purchase made before
   * 15.09.2026, and every partner who has never had a rule written — falls
   * back to `negotiatedRateBps`, which is the arithmetic those purchases have
   * always used. The product decision is explicit that existing percentage
   * partners are not to be broken.
   */
  private async contributionFor(
    intent: {
      grossAmount: Decimal;
      quantity: Decimal | null;
      quantityUnit: UnitOfMeasure | null;
      negotiatedRateBps: number;
      contributionRuleId: string | null;
      contributionRuleKind: ContributionRuleKind | null;
    },
    client: Tx | PrismaService = this.prisma,
  ): Promise<Decimal> {
    const rule = intent.contributionRuleId
      ? await client.partnerContributionRule.findUnique({
          where: { id: intent.contributionRuleId },
        })
      : null;
    return contributionForPurchase(
      intent,
      rule ? PartnerContributionRuleService.termsOf(rule) : null,
    );
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

    /*
     * Every `accountFor` below takes `tx`, and so does every one in the
     * sibling `postRedemptionCompensation`. Uniformly — that is the whole
     * point, and it is the correction of an earlier fix that got the
     * diagnosis half right.
     *
     * The earlier note here said passing `tx` caused a self-deadlock. What
     * actually caused it was *mixing*: this method looked accounts up inside
     * the transaction while `postRedemptionCompensation` looked the same ones
     * up outside it, on a second connection. The outside lookup could not see
     * the account this transaction had just created and not yet committed, so
     * its own insert blocked on this transaction's uncommitted row — a wait
     * this transaction could never clear, because it was the one waiting for
     * the query to return. Making both tx-less hid it; making both take `tx`
     * removes it, because neither can then be looking at a different
     * snapshot from the other.
     *
     * Not passing `tx` has its own, worse failure, and it is the one that
     * turned CI red (run #735). A tx-less call borrows a *second* connection
     * from the pool while this transaction already holds one. Five concurrent
     * settlements hold all five connections in a default CI-sized pool, each
     * waits for a sixth that cannot exist, and every one of them dies at
     * Prisma's 5s interactive-transaction timeout — so a duplicate callback
     * burst settled nothing at all rather than settling exactly once.
     * Reproduced by pinning `connection_limit=5` locally.
     *
     * Sequential rather than `Promise.all`: an interactive transaction is one
     * connection, so concurrent calls on it are serialised anyway, and doing
     * it in writing keeps the lock order identical between transactions.
     */
    const partnerAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId },
      tx,
    );
    const bonusLiabilityAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.BONUS_LIABILITY },
      tx,
    );
    const revenueAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.PLATFORM_REVENUE },
      tx,
    );

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
        ? [
            {
              accountId: bonusLiabilityAccount.id,
              direction: PostingDirection.CREDIT,
              amount: customerLiability,
            },
          ]
        : []),
      ...partnerReferrerPostings.filter((p): p is NonNullable<typeof p> => p !== null),
      ...(amounts.tutak.greaterThan(0)
        ? [
            {
              accountId: revenueAccount.id,
              direction: PostingDirection.CREDIT,
              amount: amounts.tutak,
            },
          ]
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
    // Both take `tx`, for the reason set out at length in
    // `postContributionLedger`: these two methods run inside the same
    // transaction and must resolve accounts through the same client, or each
    // waits on a row the other has not committed. Same order as there, too.
    const partnerAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: intent.partnerId },
      tx,
    );
    const bonusLiabilityAccount = await this.ledger.accountFor(
      { type: LedgerAccountType.BONUS_LIABILITY },
      tx,
    );

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
   * instead of `EXPIRED` (docs/REFERRAL_3_LEVEL_REWORK_2026-08-22.md requirement 11,
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
   * instead of `EXPIRED` (docs/REFERRAL_3_LEVEL_REWORK_2026-08-22.md requirement 11,
   * confirmed by independent audit — GitHub issue #28).
   */
  async reject(intentId: string, staffUserId: string, dto: RejectPurchaseIntentDto) {
    const intent = await this.findByIdOrThrow(intentId);
    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      return intent; // idempotent, same reasoning as confirm()
    }
    /*
     * The same rule as `cancel`, from the other side of the counter.
     *
     * Turning a purchase away while the provider may be holding the
     * customer's money releases their points and closes the purchase, so a
     * callback landing afterwards has nothing to complete — the customer has
     * paid and received nothing. Not named in the product decision's list of
     * expiry/cancel, but it is the same transition with the same consequence,
     * and leaving it open would have left a known hole.
     */
    if (await this.hasUnsafePspAttempt(intentId)) {
      throw new ConflictException(
        'A payment for this purchase is still being processed and it cannot be rejected yet. ' +
          'Resolve the payment first — rejecting now would leave the customer paying for ' +
          'a purchase that no longer exists.',
      );
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
          // The individual who refused, on the row itself and not only in
          // the audit log — see the column's own note. An owner asking "who
          // turned my customer away" should not need a second table.
          rejectedByUserId: staffUserId,
          rejectionReason: dto.comment ? `${dto.reasonCode}: ${dto.comment}` : dto.reasonCode,
          rejectedAt: new Date(),
        },
      });
      if (claimed.count === 0) return;

      if (intent.bonusReservationId) {
        await this.bonusEngine.releaseReservation(
          intent.bonusReservationId,
          'partner_rejected',
          tx,
        );
      }
      if (intent.prepaidHoldTransactionId) {
        await this.customerBalance.releaseHold(intent.prepaidHoldTransactionId, tx);
      }
      if (intent.sourceTransactionId) {
        await this.transactionsService.markFailed(
          intent.sourceTransactionId,
          'partner_rejected',
          tx,
        );
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

  /**
   * The customer withdraws their own purchase before any member of staff
   * has acted on it.
   *
   * Why this exists: until now the only ways out of `AWAITING_CONFIRMATION`
   * were a cashier's tap and the expiry sweep. A customer who mistyped the
   * amount, picked the wrong branch, or simply changed their mind had to
   * stand at the till and wait out the whole window with their bonus
   * reserved — `bonusEngine.reserve` has already moved it out of available
   * balance, so they cannot start the correct purchase either. At a busy
   * fuel station that is the difference between a queue that moves and one
   * that does not.
   *
   * Three deliberate choices:
   *
   * 1. `CANCELLED` is its own terminal state, not `REJECTED` with a
   *    reason. The partner's queue and its history must distinguish "our
   *    cashier turned this down" from "the customer walked away", and
   *    `rejectionReason`/`confirmedByUserId` describe a staff decision that
   *    never happened here.
   * 2. Ownership is checked here, in the service, not only in the
   *    controller: the one thing that must never be possible is one
   *    customer cancelling another's purchase, and that invariant should
   *    not depend on which route reaches this method.
   * 3. Only a repeat *cancel* is idempotent. A purchase that a cashier has
   *    already confirmed is refused rather than silently answered with its
   *    current state — the bonus and the money have moved, and a client
   *    that asked to cancel must not be told "fine" when the answer is
   *    "too late"; it is `PurchaseIntentRefundService`'s job from there.
   *
   * The expiry ordering mirrors `reject()` exactly, for the same reason
   * its docblock gives: an intent whose deadline has passed but that the
   * sweep has not reached yet is expired first and then refused, so the row
   * records what actually happened to it (the window ran out) instead of a
   * cancellation made outside the window it was valid for.
   *
   * Concurrency: the claim and the act are one atomic unit, the same
   * conditional `updateMany` the rest of this file uses. Cancel ↔ Confirm,
   * Cancel ↔ Reject, Cancel ↔ Expire and Cancel ↔ Cancel all resolve to
   * exactly one winner, because all four paths flip the same row out of
   * `AWAITING_CONFIRMATION` and only the winner's `count` is 1 — so the
   * reservation is released (or settled) exactly once, whatever the order.
   */
  async cancel(intentId: string, customerId: string) {
    const intent = await this.findByIdOrThrow(intentId);

    if (intent.customerId !== customerId) {
      throw new ForbiddenException('This purchase belongs to another customer');
    }
    if (intent.status === PurchaseIntentStatus.CANCELLED) {
      return intent; // already cancelled by this customer — idempotent
    }
    if (intent.status !== PurchaseIntentStatus.AWAITING_CONFIRMATION) {
      throw new BadRequestException('This purchase can no longer be cancelled');
    }
    /*
     * Checked before the expiry branch below, because that branch calls
     * `expireOne`, and "your purchase expired" is the wrong thing to tell
     * somebody whose money the provider may be holding.
     */
    if (await this.hasUnsafePspAttempt(intentId)) {
      throw new ConflictException(
        'A payment for this purchase is still being processed and it cannot be cancelled yet. ' +
          'If the payment did not go through, staff can resolve it — cancelling now would ' +
          'leave you paying for a purchase that no longer exists.',
      );
    }

    if (intent.expiresAt < new Date()) {
      await this.expireOne(intent);
      throw new BadRequestException('This purchase intent has expired');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseIntent.updateMany({
        where: { id: intentId, status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
        data: { status: PurchaseIntentStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (claimed.count === 0) return;

      if (intent.bonusReservationId) {
        await this.bonusEngine.releaseReservation(
          intent.bonusReservationId,
          'customer_cancelled',
          tx,
        );
      }
      if (intent.prepaidHoldTransactionId) {
        await this.customerBalance.releaseHold(intent.prepaidHoldTransactionId, tx);
      }
      if (intent.sourceTransactionId) {
        await this.transactionsService.markFailed(
          intent.sourceTransactionId,
          'customer_cancelled',
          tx,
        );
      }

      await this.auditService.record(
        {
          actorUserId: customerId,
          action: AuditAction.PURCHASE_INTENT_CANCELLED,
          entityType: 'PurchaseIntent',
          entityId: intentId,
          metadata: {},
        },
        tx,
      );
    });

    // Deliberately re-read rather than returning the row this method
    // started from: on the losing side of a Cancel ↔ Confirm race the
    // caller must be told what actually became of the purchase.
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
  private async expireOne(intent: {
    id: string;
    bonusReservationId: string | null;
    prepaidHoldTransactionId: string | null;
    sourceTransactionId: string | null;
  }): Promise<boolean> {
    /*
     * A purchase the provider may already have charged for is not stale, it
     * is pending — and the difference costs a customer their money.
     *
     * The three-minute expiry predates the provider route and does three
     * things that are all correct for somebody who walked away from a till
     * and all wrong here: it hands the reserved points back, marks the source
     * transaction failed, and moves the purchase to EXPIRED. That last one is
     * the expensive part: `settleFromProviderConfirmation` only settles a
     * purchase still awaiting confirmation, so a callback arriving after the
     * sweep would find nothing to complete. Money in, nothing out.
     *
     * Skipped rather than deferred: there is no useful new expiry time to
     * pick, because what this is waiting for is the provider, not the clock.
     * The PSP ageing sweep escalates it; an authoritative answer or a
     * two-person reconciliation releases it; and then the very next tick of
     * this sweep expires it normally. The database refuses the transition
     * too — see `purchase_intent_not_abandoned_while_paying`.
     */
    if (await this.hasUnsafePspAttempt(intent.id)) {
      this.logger.warn(
        `Purchase ${intent.id} is past its expiry but a payment attempt is unresolved — ` +
          'leaving it pending rather than releasing the reservation',
      );
      return false;
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseIntent.updateMany({
        where: { id: intent.id, status: PurchaseIntentStatus.AWAITING_CONFIRMATION },
        data: { status: PurchaseIntentStatus.EXPIRED },
      });
      if (claimed.count === 0) return false;

      if (intent.bonusReservationId) {
        await this.bonusEngine.releaseReservation(
          intent.bonusReservationId,
          'purchase_intent_expired',
          tx,
        );
      }
      // Same exactly-once release as the bonus: the status claim above is
      // what authorises it, and both commit with it or not at all.
      if (intent.prepaidHoldTransactionId) {
        await this.customerBalance.releaseHold(intent.prepaidHoldTransactionId, tx);
      }
      if (intent.sourceTransactionId) {
        await this.transactionsService.markFailed(
          intent.sourceTransactionId,
          'purchase_intent_expired',
          tx,
        );
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
