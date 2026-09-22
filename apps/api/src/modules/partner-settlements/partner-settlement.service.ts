import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  Currency,
  LedgerAccountType,
  PartnerSettlementStatus,
  PaymentRoute,
  PurchaseIntentStatus,
  PostingDirection,
  Prisma,
  ReconciliationOutcome,
  ReconciliationSource,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  ALLOCATION_LEDGER_KINDS,
  SETTLEABLE_LEDGER_KINDS,
  SETTLEMENT_PAID_KIND,
  unrecognisedKinds,
} from './settleable-kinds';

type Tx = Prisma.TransactionClient;

/**
 * The states a bank transfer may be attempted from.
 *
 * `FAILED` is in the list deliberately. A settlement is the statement of what
 * a partner is owed; a bank refusing to move the money does not change what
 * is owed, it only means nobody has moved it yet. Treating `FAILED` as
 * terminal stranded the claimed postings for ever — the bug the product review of
 * 15.09.2026 found.
 *
 * `REQUIRES_RECONCILIATION` is deliberately *not* in the list. There the
 * question is not "has it been paid yet" but "did the last attempt already
 * pay it", and only a human reading the bank statement can answer that.
 */
const TRANSFER_ATTEMPTABLE: readonly PartnerSettlementStatus[] = [
  PartnerSettlementStatus.APPROVED,
  PartnerSettlementStatus.PAYMENT_PENDING,
  PartnerSettlementStatus.FAILED,
];

/**
 * The marker that makes the partial unique index
 * `(settlementId, successKey)` mean "at most one successful transfer per
 * settlement". Set on the winning attempt and on no other, so a second
 * success is a unique violation rather than a second row nobody notices.
 */
const TRANSFER_SUCCESS_KEY = 'paid';

export interface UnsettledEntry {
  ledgerPostingId: string;
  amount: Decimal;
  direction: PostingDirection;
  kind: string;
  sourceType: string;
  sourceId: string;
  occurredAt: Date;
}

export interface UnsettledBreakdown {
  partnerId: string;
  accrued: Decimal;
  deductions: Decimal;
  net: Decimal;
  entries: UnsettledEntry[];
  /** Kinds seen on this partner's unclaimed postings that nobody classified. */
  unrecognised: string[];
}

/**
 * The five figures a partner reads on their settlements page — see
 * `UnsettledPositionDto` in shared-types for what each one means and why they
 * never overlap.
 */
export interface PartnerPosition extends UnsettledBreakdown {
  ledgerBalance: Decimal;
  inOpenSettlements: Decimal;
  underReview: Decimal;
  paidTotal: Decimal;
  asOf: Date;
  funding: PartnerFundingBreakdown;
}

/**
 * The owner's brief §29 (20.09.2026): where the money in a partner's sales
 * actually came from, and what each source did to the position. All-time,
 * confirmed purchases only, net of refunds where a refund reverses the
 * figure. Every line is either a sum over `PurchaseIntent` rows or a sum of
 * postings of one ledger kind on the partner's payable — nothing here is a
 * second arithmetic of the position, which is why `ledgerBalance` is not
 * derivable from these and is not meant to be.
 */
export interface PartnerFundingBreakdown {
  /** Gross of every confirmed sale. */
  salesGross: Decimal;
  /** What the partner took at their own till (cash / their own card terminal) — never TuTak's money. `DIRECT_PARTNER` only. */
  receivedDirectly: Decimal;
  /** What the provider collected for TuTak on `TUTAK_PSP` sales — TuTak's to settle, never in the till (audit D12). */
  receivedViaProvider: Decimal;
  /** Paid from customers' stored balances: TuTak owes this to the partner (`partner.prepaid_funding`, net of refunds). */
  fundedByPrepaid: Decimal;
  /** Paid in bonus: TuTak compensates it (`partner.bonus_redemption_compensation`, net of refunds). */
  fundedByBonus: Decimal;
  /** The partner's contribution to the pool (`partner.contribution`, net of refunds). Reduces what TuTak owes. */
  contribution: Decimal;
  /** Merchandise value refunded across all sales. */
  refundedGross: Decimal;
  /** What the partner currently owes TuTak, if the ledger is on that side; zero otherwise. */
  owedToTuTak: Decimal;
  /** Transfers the partner made to TuTak that both sides have confirmed. */
  collectionsConfirmed: Decimal;
}

/**
 * Turns a partner's unsettled ledger postings into a bank transfer somebody
 * makes by hand, and records that they made it.
 *
 * ## The one idea this rests on
 *
 * A settlement does not *compute* an amount and store it. It **claims
 * postings**. `PartnerSettlementEntry.ledgerPostingId` is unique, so a
 * posting belongs to at most one settlement, for ever, enforced by the
 * database rather than by this file being careful.
 *
 * Everything the brief asks for falls out of that:
 *
 * - *The figure cannot drift after approval.* A purchase made a second later
 *   writes a new posting, and a new posting is by definition not claimed by
 *   an existing settlement.
 * - *A partner cannot be paid twice for the same sale.* Two settlements
 *   racing for the same posting: one insert wins, the other gets a unique
 *   violation and retries against what is left.
 * - *Refund after payout needs no special case.* The reversing postings a
 *   refund writes are simply unclaimed, so the next settlement picks them up
 *   as deductions. The PAID settlement is never touched — the database
 *   refuses to touch it.
 * - *A negative balance explains itself.* Every claimed posting keeps its own
 *   `kind` and source row, so "why do I owe you 25,000" is answerable down to
 *   the individual purchase.
 *
 * ## What it deliberately does not do
 *
 * It never moves money. Transfers are made by a human in a banking app, per
 * the product decision of 14.09.2026, and this engine only records that it
 * happened and closes out the matching liability. There is no bank adapter
 * here and adding one is a separate decision.
 */
@Injectable()
export class PartnerSettlementService {
  private readonly logger = new Logger(PartnerSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get dualControl(): boolean {
    return this.config.get('payouts.dualControl', { infer: true });
  }

  /**
   * What this partner is owed but has not been settled for.
   *
   * Reads postings, not a stored balance: a stored balance is a second source
   * of truth, and the whole point of claiming is that "unsettled" is a fact
   * about the ledger rather than a number somebody maintains.
   */
  async unsettled(
    partnerId: string,
    opts: { until?: Date; tx?: Tx } = {},
  ): Promise<UnsettledBreakdown> {
    const db = opts.tx ?? this.prisma;
    const account = await db.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
      select: { id: true },
    });
    if (!account) {
      const zero = new Decimal(0);
      return {
        partnerId,
        accrued: zero,
        deductions: zero,
        net: zero,
        entries: [],
        unrecognised: [],
      };
    }

    const postings = await db.ledgerPosting.findMany({
      where: { accountId: account.id, settlementEntry: null },
      select: {
        id: true,
        amount: true,
        direction: true,
        transaction: { select: { kind: true, sourceType: true, sourceId: true, postedAt: true } },
      },
      orderBy: { id: 'asc' },
    });

    const entries: UnsettledEntry[] = [];
    let accrued = new Decimal(0);
    let deductions = new Decimal(0);

    for (const posting of postings) {
      const kind = posting.transaction.kind;
      // Economic postings are claimed up to the period end. Allocations —
      // a legacy payout, a collection — are claimed whenever they exist:
      // they are money that already moved against this residual, and a
      // period boundary must not leave them out of the settlement that
      // pays the entries they settled (audit D02/D03).
      if (SETTLEABLE_LEDGER_KINDS.has(kind)) {
        if (opts.until && posting.transaction.postedAt > opts.until) continue;
      } else if (!ALLOCATION_LEDGER_KINDS.has(kind)) {
        continue;
      }
      entries.push({
        ledgerPostingId: posting.id,
        amount: posting.amount,
        direction: posting.direction,
        kind: posting.transaction.kind,
        sourceType: posting.transaction.sourceType,
        sourceId: posting.transaction.sourceId,
        occurredAt: posting.transaction.postedAt,
      });
      // CREDIT on a payable account increases what the platform owes.
      if (posting.direction === PostingDirection.CREDIT) accrued = accrued.plus(posting.amount);
      else deductions = deductions.plus(posting.amount);
    }

    return {
      partnerId,
      accrued,
      deductions,
      net: accrued.minus(deductions),
      entries,
      unrecognised: unrecognisedKinds(postings.map((p) => p.transaction.kind)),
    };
  }

  /**
   * What the partner is owed, in figures that do not overlap.
   *
   * `unsettled()` alone was what the partner's page showed as "accruing now",
   * and a DRAFT settlement made it read zero while the money was still owed:
   * a draft claims the postings, so they stop being unsettled, and nothing
   * is paid until PAID. The total comes from the payable account's own
   * balance — credit-normal, so negated here: positive means TuTak owes the
   * partner. The open and under-review sums come from the settlements
   * themselves. The identity `ledgerBalance = net + inOpenSettlements +
   * underReview` holds because PAID is the only status that posts a payout,
   * and CANCELLED releases its claims back into `net`
   * (`partner-position.int-spec.ts` pins it).
   */
  async position(partnerId: string): Promise<PartnerPosition> {
    // One snapshot (audit D04): the four reads run sequentially inside a
    // REPEATABLE READ transaction, so a draft created or cancelled between
    // them cannot show the same 50 000 as both "not yet settled" and "in a
    // settlement". Sequential rather than `Promise.all` because an
    // interactive transaction is one connection.
    const position = await this.prisma.$transaction(
      async (tx) => {
        const breakdown = await this.unsettled(partnerId, { tx });
        const account = await tx.ledgerAccount.findFirst({
          where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
          select: { balance: true },
        });
        const settlements = await tx.partnerSettlement.findMany({
          where: { partnerId },
          select: { status: true, netPayableAmount: true },
        });
        const funding = await this.fundingBreakdown(partnerId, tx);

        const sum = (statuses: PartnerSettlementStatus[]) =>
          settlements
            .filter((row) => statuses.includes(row.status))
            .reduce((total, row) => total.plus(row.netPayableAmount), new Decimal(0));

        return {
          ...breakdown,
          ledgerBalance: account ? account.balance.negated() : new Decimal(0),
          inOpenSettlements: sum([
            PartnerSettlementStatus.DRAFT,
            PartnerSettlementStatus.READY,
            PartnerSettlementStatus.APPROVED,
            PartnerSettlementStatus.PAYMENT_PENDING,
            PartnerSettlementStatus.FAILED,
          ]),
          underReview: sum([PartnerSettlementStatus.REQUIRES_RECONCILIATION]),
          paidTotal: sum([PartnerSettlementStatus.PAID]),
          asOf: new Date(),
          funding,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    // Branch names are resolved after the snapshot closes, not inside it.
    // They are labels, not figures: the money in this position has to come
    // from one consistent read, a shop's name does not, and holding the
    // REPEATABLE READ transaction open for two more lookups buys nothing.
    const branchBySource = await this.branchesForEntries(position.entries);
    return {
      ...position,
      entries: position.entries.map((entry) => ({
        ...entry,
        branch: branchBySource.get(`${entry.sourceType}:${entry.sourceId}`) ?? null,
      })),
    };
  }

  private async fundingBreakdown(partnerId: string, tx: Tx): Promise<PartnerFundingBreakdown> {
    const zero = new Decimal(0);
    // Sequential on `tx`: one connection, one snapshot (see `position`).
    const sales = await tx.purchaseIntent.aggregate({
      where: { partnerId, status: PurchaseIntentStatus.CONFIRMED },
      _sum: {
        grossAmount: true,
        prepaidAmountApplied: true,
        bonusAmountRequested: true,
        refundedAmount: true,
      },
    });
    // The remainder by route (audit D12): at the till it is the partner's
    // own money; through the provider it is TuTak's, collected on the
    // partner's behalf and settled through the payable. Summing both as
    // "received directly" made provider money look like cash in the till.
    const remainderByRoute = await tx.purchaseIntent.groupBy({
      by: ['paymentRoute'],
      where: { partnerId, status: PurchaseIntentStatus.CONFIRMED },
      _sum: { ordinaryPaymentRemainder: true },
    });
    const byKind = await tx.ledgerPosting.findMany({
      where: {
        account: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
        transaction: {
          kind: {
            in: [
              'partner.contribution',
              'partner.contribution_refund',
              'partner.bonus_redemption_compensation',
              'partner.bonus_redemption_compensation_refund',
              'partner.prepaid_funding',
              'partner.prepaid_funding_refund',
              'partner.collection.recorded',
              'partner.collection.confirmed',
            ],
          },
        },
      },
      select: { amount: true, direction: true, transaction: { select: { kind: true } } },
    });
    const account = await tx.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
      select: { balance: true },
    });
    const remainderFor = (route: PaymentRoute) =>
      remainderByRoute.find((row) => row.paymentRoute === route)?._sum.ordinaryPaymentRemainder ?? zero;

    // Credits positive, debits negative — so a kind and its refund net out.
    const signed = new Map<string, Decimal>();
    for (const posting of byKind) {
      const kind = posting.transaction.kind;
      const delta = posting.direction === PostingDirection.CREDIT ? posting.amount : posting.amount.negated();
      signed.set(kind, (signed.get(kind) ?? zero).plus(delta));
    }
    const net = (kind: string, refundKind: string) =>
      (signed.get(kind) ?? zero).plus(signed.get(refundKind) ?? zero);

    const raw = account?.balance ?? zero;
    return {
      salesGross: sales._sum.grossAmount ?? zero,
      receivedDirectly: remainderFor(PaymentRoute.DIRECT_PARTNER),
      receivedViaProvider: remainderFor(PaymentRoute.TUTAK_PSP),
      fundedByPrepaid: net('partner.prepaid_funding', 'partner.prepaid_funding_refund'),
      fundedByBonus: net('partner.bonus_redemption_compensation', 'partner.bonus_redemption_compensation_refund'),
      // Contribution is a debit; shown as the positive amount the partner contributes.
      contribution: net('partner.contribution', 'partner.contribution_refund').negated(),
      refundedGross: sales._sum.refundedAmount ?? zero,
      owedToTuTak: raw.greaterThan(0) ? raw : zero,
      // A confirmed collection credits the payable (the partner's debt shrinks).
      // A single-step collection (dual control off) is confirmed the moment
      // it is recorded, under its own kind.
      collectionsConfirmed: (signed.get('partner.collection.confirmed') ?? zero).plus(
        signed.get('partner.collection.recorded') ?? zero,
      ),
    };
  }

  /**
   * Claims everything settleable up to `periodEnd` into a new DRAFT.
   *
   * Refuses a non-positive net rather than creating a settlement for it. That
   * is not squeamishness: claiming a negative balance would *consume* the
   * postings that represent the partner's debt, and the debt has to stay
   * unclaimed so the next period picks it up and offsets it against new
   * earnings — which is exactly what the product decision calls for.
   */
  async createDraft(params: {
    partnerId: string;
    periodStart: Date;
    periodEnd: Date;
    actorId: string;
  }) {
    if (params.periodEnd <= params.periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }

    return this.prisma.$transaction(async (tx) => {
      // First statement in the transaction, before anything is read that the
      // decision rests on (audit 22.09, D02d/D02e/D02j). A legacy payout
      // against this same entitlement takes the same lock, so the two cannot
      // both read 50 000 as free and both promise it: whichever arrives
      // second waits here and then re-reads a `net` that already reflects the
      // first. Without it, `unsettled()` below reads a snapshot a concurrent
      // payout is about to invalidate, and the partner is promised the money
      // twice — reproduced on PostgreSQL before this line existed.
      await this.ledger.lockPartnerPayable(tx, params.partnerId);

      const partner = await tx.partner.findUnique({
        where: { id: params.partnerId },
        select: { id: true, payoutsBlockedAt: true, payoutsBlockedReason: true },
      });
      if (!partner) throw new NotFoundException('Partner not found');
      if (partner.payoutsBlockedAt) {
        throw new ConflictException(
          `Payouts are blocked for this partner: ${partner.payoutsBlockedReason ?? 'no reason recorded'}`,
        );
      }

      const open = await tx.partnerSettlement.findFirst({
        where: {
          partnerId: params.partnerId,
          status: {
            in: [
              PartnerSettlementStatus.DRAFT,
              PartnerSettlementStatus.READY,
              PartnerSettlementStatus.APPROVED,
              PartnerSettlementStatus.PAYMENT_PENDING,
            ],
          },
        },
        select: { id: true, status: true },
      });
      if (open) {
        throw new ConflictException(
          `Settlement ${open.id} is still ${open.status}; finish or cancel it before starting another`,
        );
      }

      const breakdown = await this.unsettled(params.partnerId, { until: params.periodEnd, tx });
      if (breakdown.net.lessThanOrEqualTo(0)) {
        throw new ConflictException(
          `Nothing to pay: this partner's unsettled balance is ${breakdown.net.toFixed(2)}. ` +
            'A non-positive balance is carried into the next period and offset against future earnings, ' +
            'not settled.',
        );
      }

      const settlement = await tx.partnerSettlement.create({
        data: {
          partnerId: params.partnerId,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
          status: PartnerSettlementStatus.DRAFT,
          accruedAmount: breakdown.accrued,
          deductionAmount: breakdown.deductions,
          netPayableAmount: breakdown.net,
          entryCount: breakdown.entries.length,
          createdByUserId: params.actorId,
        },
      });

      // One statement, so two concurrent drafts cannot interleave: the loser
      // hits the unique index on `ledgerPostingId` and its whole transaction
      // rolls back, settlement row included.
      await tx.partnerSettlementEntry.createMany({
        data: breakdown.entries.map((entry) => ({
          settlementId: settlement.id,
          ledgerPostingId: entry.ledgerPostingId,
          partnerId: params.partnerId,
          amount: entry.amount,
          direction: entry.direction,
          kind: entry.kind,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          occurredAt: entry.occurredAt,
        })),
      });

      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerSettlement',
          entityId: settlement.id,
          metadata: {
            event: 'settlement.draft_created',
            partnerId: params.partnerId,
            net: breakdown.net.toFixed(4),
            entryCount: breakdown.entries.length,
          },
        },
        tx,
      );

      return settlement;
    });
  }

  /** Attaches the accounting document and freezes the figures for approval. */
  async markReady(
    id: string,
    params: {
      actorId: string;
      documentNumber?: string;
      documentDate?: Date;
      documentReference?: string;
    },
  ) {
    return this.transition(id, {
      from: [PartnerSettlementStatus.DRAFT],
      to: PartnerSettlementStatus.READY,
      actorId: params.actorId,
      data: {
        documentNumber: params.documentNumber ?? null,
        documentDate: params.documentDate ?? null,
        documentReference: params.documentReference ?? null,
      },
      event: 'settlement.ready',
    });
  }

  /**
   * The checker half of maker/checker.
   *
   * Refuses the creator when dual control is on — the same rule
   * `PartnerCollectionService` already applies to money coming the other way,
   * and the reason is the same: one person should not be able to move the
   * platform's money on their own say-so.
   *
   * Snapshots where the money is going. If the partner's bank details change
   * afterwards, this settlement still says where it was approved to go.
   */
  async approve(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.partnerSettlement.findUnique({ where: { id } });
      if (!settlement) throw new NotFoundException('Settlement not found');
      if (settlement.status !== PartnerSettlementStatus.READY) {
        throw new ConflictException(`Settlement is ${settlement.status}, not READY`);
      }
      if (this.dualControl && settlement.createdByUserId === actorId) {
        throw new ForbiddenException(
          'The person who created a settlement cannot approve it. Ask a second administrator.',
        );
      }

      const account = await tx.partnerBankAccount.findFirst({
        where: { partnerId: settlement.partnerId, isActive: true },
      });
      if (!account) {
        throw new ConflictException(
          'This partner has no active bank account on file. Record one before approving a transfer to it.',
        );
      }

      const claimed = await tx.partnerSettlement.updateMany({
        where: { id, status: PartnerSettlementStatus.READY },
        data: {
          status: PartnerSettlementStatus.APPROVED,
          approvedByUserId: actorId,
          approvedAt: new Date(),
          bankAccountId: account.id,
          beneficiarySnapshot: {
            beneficiaryName: account.beneficiaryName,
            accountNumber: account.accountNumber,
            bankName: account.bankName,
            swiftBic: account.swiftBic,
          },
        },
      });
      if (claimed.count === 0) throw new ConflictException('Settlement changed while approving');

      await this.audit.record(
        {
          actorUserId: actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerSettlement',
          entityId: id,
          metadata: { event: 'settlement.approved', partnerId: settlement.partnerId },
        },
        tx,
      );
      return tx.partnerSettlement.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * The transfer has been initiated by hand; nothing is posted yet.
   *
   * `FAILED` is in the accepted set because a bounced transfer does not
   * change what is owed — see `TRANSFER_ATTEMPTABLE`.
   */
  async markPaymentPending(id: string, actorId: string) {
    return this.transition(id, {
      from: [...TRANSFER_ATTEMPTABLE],
      to: PartnerSettlementStatus.PAYMENT_PENDING,
      actorId,
      data: {},
      event: 'settlement.payment_pending',
    });
  }

  /**
   * The bank confirmed it. This is the only step that posts.
   *
   * DEBIT `PARTNER_PAYABLE` / CREDIT `PLATFORM_BANK`: the liability is
   * discharged and the platform's own cash is lower. The posting's `kind` is
   * in `TRANSFER_LEDGER_KINDS`, so it is never itself claimable — otherwise
   * the next settlement would deduct the transfer a second time.
   *
   * Pressing "paid" twice cannot pay twice: the claim is a conditional
   * `updateMany` on the status inside the same transaction as the posting, so
   * the second press finds nothing to claim and posts nothing. Past this
   * point the row is immutable at the database level.
   */
  async markPaid(id: string, params: { actorId: string; bankTransferReference: string }) {
    return this.payFrom(id, {
      actorId: params.actorId,
      bankTransferReference: params.bankTransferReference,
      from: TRANSFER_ATTEMPTABLE,
      event: 'settlement.paid',
    });
  }

  /**
   * The single place a settlement is ever closed against real money.
   *
   * `from` is what makes the two callers different and nothing else: the
   * ordinary path accepts an approved or in-flight settlement, and
   * reconciliation accepts only one that was flagged ambiguous. Sharing the
   * body is the point — two copies of "post and mark paid" is two chances to
   * post twice.
   */
  private async payFrom(
    id: string,
    params: {
      actorId: string;
      bankTransferReference: string;
      from: readonly PartnerSettlementStatus[];
      event: string;
      /** Extra columns to stamp on the same claim — a reconciliation's checker. */
      extra?: Prisma.PartnerSettlementUpdateManyMutationInput;
    },
  ) {
    const reference = params.bankTransferReference.trim();
    if (!reference) throw new BadRequestException('A bank transfer reference is required');

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.partnerSettlement.findUnique({ where: { id } });
      if (!settlement) throw new NotFoundException('Settlement not found');
      if (!params.from.includes(settlement.status)) {
        throw new ConflictException(
          settlement.status === PartnerSettlementStatus.REQUIRES_RECONCILIATION
            ? 'Settlement needs reconciliation; resolve it explicitly rather than marking it paid'
            : `Settlement is ${settlement.status}; expected one of ${params.from.join(', ')}`,
        );
      }

      // Both on `tx`. A tx-less lookup here borrows a second pool connection
      // while this transaction holds one — the pattern that starved the pool
      // under concurrent provider callbacks (CI #735), now guarded against
      // statically by `transaction-discipline.spec.ts`. Sequential rather
      // than `Promise.all`: an interactive transaction is one connection.
      const payableAccount = await this.ledger.accountFor(
        { type: LedgerAccountType.PARTNER_PAYABLE, partnerId: settlement.partnerId },
        tx,
      );
      const bankAccount = await this.ledger.accountFor(
        { type: LedgerAccountType.PLATFORM_BANK },
        tx,
      );

      const posted = await this.ledger.post(
        {
          kind: SETTLEMENT_PAID_KIND,
          sourceType: 'PartnerSettlement',
          sourceId: id,
          currency: settlement.currency,
          postings: [
            {
              accountId: payableAccount.id,
              direction: PostingDirection.DEBIT,
              amount: settlement.netPayableAmount,
            },
            {
              accountId: bankAccount.id,
              direction: PostingDirection.CREDIT,
              amount: settlement.netPayableAmount,
            },
          ],
        },
        tx,
      );

      const claimed = await tx.partnerSettlement.updateMany({
        where: { id, status: settlement.status },
        data: {
          ...params.extra,
          status: PartnerSettlementStatus.PAID,
          paidByUserId: params.actorId,
          paidAt: new Date(),
          bankTransferReference: reference,
          ledgerTransactionId: posted.id,
        },
      });
      if (claimed.count === 0) {
        // Somebody else got there first. Rolling back takes the posting with
        // it, which is the point: the money is recorded once or not at all.
        throw new ConflictException('Settlement was already resolved by someone else');
      }

      await this.recordAttempt(tx, settlement, {
        actorId: params.actorId,
        outcome: 'succeeded',
        bankTransferReference: reference,
      });

      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerSettlement',
          entityId: id,
          metadata: {
            event: params.event,
            partnerId: settlement.partnerId,
            amount: settlement.netPayableAmount.toFixed(4),
            bankTransferReference: reference,
          },
        },
        tx,
      );
      return tx.partnerSettlement.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * The bank refused the transfer, or returned it, and we know for certain
   * that no money left. The settlement stays exactly as it is — same claimed
   * entries, same figure — and a new transfer may be attempted against it.
   *
   * It used to be terminal. That was a real bug, found in the product review of
   * 15.09.2026: the entries stayed claimed and no settlement could ever pick
   * them up again, so a partner whose transfer bounced was silently never
   * paid for those sales. "A fresh settlement is made for the retry" — what
   * the old docblock here claimed — could not happen, because the postings
   * that fresh settlement would need were already spoken for.
   *
   * Only call this when the bank's answer is unambiguous. If it is not,
   * `markRequiresReconciliation` is the honest answer: a retry on a maybe is
   * how a partner gets paid twice. Resolving one of those takes evidence and
   * two different people — see `proposeReconciliationOutcome`.
   */
  async markFailed(
    id: string,
    params: { actorId: string; reason: string; bankTransferReference?: string },
  ) {
    return this.recordOutcome(id, {
      actorId: params.actorId,
      reason: params.reason,
      bankTransferReference: params.bankTransferReference,
      to: PartnerSettlementStatus.FAILED,
      outcome: 'failed',
      event: 'settlement.failed',
    });
  }

  /**
   * The bank's answer is ambiguous: a timeout, a reference it cannot find, a
   * partial. The money may or may not have left.
   *
   * This never retries and never posts. Both would be guesses, and the two
   * wrong guesses cost differently: guessing "it went" leaves a partner
   * unpaid with a ledger that says otherwise, guessing "it did not go" pays
   * them twice. A human reads the bank statement and calls
   * `proposeReconciliationOutcome` with what it actually says, and a second
   * person confirms it.
   */
  async markRequiresReconciliation(
    id: string,
    params: {
      actorId: string;
      reason: string;
      bankTransferReference?: string;
      /** Defaults to FINANCE. `PARTNER_REPORT` locks the reporter out of resolving it. */
      source?: ReconciliationSource;
    },
  ) {
    const source = params.source ?? ReconciliationSource.FINANCE;
    return this.recordOutcome(id, {
      actorId: params.actorId,
      reason: params.reason,
      bankTransferReference: params.bankTransferReference,
      to: PartnerSettlementStatus.REQUIRES_RECONCILIATION,
      outcome: 'unresolved',
      event: 'settlement.requires_reconciliation',
      extra: {
        reconciliationSource: source,
        reconciliationReportedByUserId: params.actorId,
        reconciliationReportedAt: new Date(),
      },
    });
  }

  /**
   * A partner says the money never arrived.
   *
   * Deliberately its own method rather than a flag on the one above, because
   * it is a different act by a different kind of person. The product decision of
   * 15.09.2026: a partner may report a problem and may not confirm whether
   * money moved — they are the payee, and a payee who can both report a
   * missing transfer and confirm that it never arrived can order their own
   * second payment.
   *
   * So this records the doubt, moves the settlement out of the payable set,
   * and locks the reporter out of both halves of resolving it. The database
   * enforces the lock-out as well (see
   * `partner_settlements_partner_reporter_does_not_resolve`), because a
   * service method is not a boundary a script has to respect.
   */
  async reportTransferProblem(
    id: string,
    params: { partnerUserId: string; partnerId: string; reason: string },
  ) {
    const settlement = await this.prisma.partnerSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.partnerId !== params.partnerId) {
      // Not "forbidden": a partner should not learn that another partner's
      // settlement exists by being told they may not touch it.
      throw new NotFoundException('Settlement not found');
    }

    return this.recordOutcome(id, {
      actorId: params.partnerUserId,
      reason: params.reason,
      to: PartnerSettlementStatus.REQUIRES_RECONCILIATION,
      outcome: 'unresolved',
      event: 'settlement.partner_reported_problem',
      extra: {
        reconciliationSource: ReconciliationSource.PARTNER_REPORT,
        reconciliationReportedByUserId: params.partnerUserId,
        reconciliationReportedAt: new Date(),
      },
    });
  }

  /**
   * Somebody in finance has read the bank statement and says what it shows.
   *
   * This is the **proposal**, and on its own it moves nothing. The product
   * decision of 15.09.2026 is that an ambiguous transfer is resolved by two
   * different people with evidence between them — the same maker/checker rule
   * the settlement's own approval already has, applied to the other decision
   * that moves money.
   *
   * The evidence is free-form and mandatory. Free-form because a statement
   * line, a wire reference and a bank's own case id are all legitimate and
   * requiring a shape would mean guessing what the bank provides; mandatory
   * because "we think it went through" with nothing behind it is precisely
   * what this mechanism exists to stop.
   *
   * Re-proposing is allowed while nobody has confirmed — a first reading of a
   * statement can be wrong, and forcing a new settlement to correct it would
   * be worse. Once confirmed, the settlement has left this state entirely.
   */
  async proposeReconciliationOutcome(
    id: string,
    params: {
      actorId: string;
      outcome: ReconciliationOutcome;
      evidence: string;
      /** Required for MONEY_MOVED: the reference that proves it. */
      bankTransferReference?: string;
    },
  ) {
    const evidence = params.evidence.trim();
    if (!evidence) {
      throw new BadRequestException('Say what the bank statement shows — evidence is required');
    }
    if (
      params.outcome === ReconciliationOutcome.MONEY_MOVED &&
      !params.bankTransferReference?.trim()
    ) {
      throw new BadRequestException('A transfer that went through has a bank reference; name it');
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.partnerSettlement.findUnique({ where: { id } });
      if (!settlement) throw new NotFoundException('Settlement not found');
      if (settlement.status !== PartnerSettlementStatus.REQUIRES_RECONCILIATION) {
        throw new ConflictException(
          `Settlement is ${settlement.status}; only one awaiting reconciliation can be resolved`,
        );
      }
      this.assertNotTheReporter(settlement, params.actorId);

      await tx.partnerSettlement.update({
        where: { id },
        data: {
          reconciliationOutcome: params.outcome,
          reconciliationEvidence: evidence,
          reconciliationProposedByUserId: params.actorId,
          reconciliationProposedAt: new Date(),
          // A fresh proposal clears any earlier confirmation attempt's
          // fields; nothing can be confirmed that has not been proposed since.
          reconciliationConfirmedByUserId: null,
          reconciliationConfirmedAt: null,
          bankTransferReference:
            params.outcome === ReconciliationOutcome.MONEY_MOVED
              ? params.bankTransferReference!.trim()
              : settlement.bankTransferReference,
        },
      });

      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerSettlement',
          entityId: id,
          metadata: {
            event: 'settlement.reconciliation_proposed',
            partnerId: settlement.partnerId,
            amount: settlement.netPayableAmount.toFixed(4),
            outcome: params.outcome,
            evidence,
          },
        },
        tx,
      );
      return tx.partnerSettlement.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * The second pair of eyes, and the act that finally moves the settlement.
   *
   * `MONEY_MOVED` closes it exactly as `markPaid` would, through the same
   * `payFrom` — one posting, written once. `MONEY_DID_NOT_MOVE` returns it to
   * the retryable `FAILED` state.
   *
   * The checker may not be the proposer, and neither may be a partner who
   * reported the problem. Both rules are also CHECK constraints, because a
   * service method is a convenience and the table is the boundary.
   */
  async confirmReconciliationOutcome(id: string, params: { actorId: string }) {
    const settlement = await this.prisma.partnerSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== PartnerSettlementStatus.REQUIRES_RECONCILIATION) {
      throw new ConflictException(
        `Settlement is ${settlement.status}; only one awaiting reconciliation can be resolved`,
      );
    }
    if (!settlement.reconciliationOutcome || !settlement.reconciliationProposedByUserId) {
      throw new ConflictException('Nobody has proposed what the bank statement shows yet');
    }
    this.assertNotTheReporter(settlement, params.actorId);
    if (this.dualControl && settlement.reconciliationProposedByUserId === params.actorId) {
      throw new ForbiddenException(
        'You proposed this reconciliation; a second person has to confirm it',
      );
    }

    const confirmed = {
      reconciliationConfirmedByUserId: params.actorId,
      reconciliationConfirmedAt: new Date(),
    };

    if (settlement.reconciliationOutcome === ReconciliationOutcome.MONEY_MOVED) {
      return this.payFrom(id, {
        actorId: params.actorId,
        bankTransferReference: settlement.bankTransferReference!,
        from: [PartnerSettlementStatus.REQUIRES_RECONCILIATION],
        event: 'settlement.reconciled_paid',
        extra: confirmed,
      });
    }

    return this.recordOutcome(id, {
      actorId: params.actorId,
      reason: settlement.reconciliationEvidence ?? 'Reconciled: the statement shows no debit',
      to: PartnerSettlementStatus.FAILED,
      outcome: 'failed',
      event: 'settlement.reconciled_failed',
      from: [PartnerSettlementStatus.REQUIRES_RECONCILIATION],
      extra: confirmed,
    });
  }

  /**
   * A partner who reported a missing transfer does not get to settle the
   * question of whether it happened. Checked here so the caller gets a
   * sentence; also a CHECK constraint, so a script gets refused too.
   */
  private assertNotTheReporter(
    settlement: {
      reconciliationSource: ReconciliationSource | null;
      reconciliationReportedByUserId: string | null;
    },
    actorId: string,
  ): void {
    if (
      settlement.reconciliationSource === ReconciliationSource.PARTNER_REPORT &&
      settlement.reconciliationReportedByUserId === actorId
    ) {
      throw new ForbiddenException(
        'You reported this problem; whether the money moved is for finance to establish',
      );
    }
  }

  /**
   * Abandoned before any money moved. Releases the claims, so the postings
   * return to the partner's unsettled balance and the next settlement can
   * pick them up.
   */
  async cancel(id: string, params: { actorId: string; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerSettlement.updateMany({
        where: {
          id,
          status: { in: [PartnerSettlementStatus.DRAFT, PartnerSettlementStatus.READY] },
        },
        data: {
          status: PartnerSettlementStatus.CANCELLED,
          cancelledByUserId: params.actorId,
          cancelledAt: new Date(),
          cancelledReason: params.reason,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Only a draft or ready settlement can be cancelled');
      }
      // Deleting the claims is what releases the postings. The trigger allows
      // it because the settlement is not approved or beyond.
      await tx.partnerSettlementEntry.deleteMany({ where: { settlementId: id } });

      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerSettlement',
          entityId: id,
          metadata: { event: 'settlement.cancelled', reason: params.reason },
        },
        tx,
      );
      return tx.partnerSettlement.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Record the outcome of one transfer attempt and move the settlement to the
   * state that outcome implies.
   *
   * Both halves happen in one transaction on purpose: a settlement that says
   * `FAILED` with no attempt row explaining which transfer failed is exactly
   * the audit gap this whole model exists to close.
   */
  private async recordOutcome(
    id: string,
    params: {
      actorId: string;
      reason: string;
      bankTransferReference?: string;
      to: PartnerSettlementStatus;
      outcome: 'failed' | 'unresolved';
      event: string;
      from?: readonly PartnerSettlementStatus[];
      /** Extra columns to stamp on the same claim, inside the same transaction. */
      extra?: Prisma.PartnerSettlementUpdateManyMutationInput;
    },
  ) {
    const reason = params.reason.trim();
    if (!reason) throw new BadRequestException('A reason is required');
    const from = params.from ?? TRANSFER_ATTEMPTABLE;

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.partnerSettlement.findUnique({ where: { id } });
      if (!settlement) throw new NotFoundException('Settlement not found');

      const claimed = await tx.partnerSettlement.updateMany({
        where: { id, status: { in: [...from] } },
        data: { ...params.extra, status: params.to, failedReason: reason },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          `Settlement is ${settlement.status}; expected one of ${from.join(', ')}`,
        );
      }

      await this.recordAttempt(tx, settlement, {
        actorId: params.actorId,
        outcome: params.outcome,
        reason,
        bankTransferReference: params.bankTransferReference,
      });

      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerSettlement',
          entityId: id,
          metadata: {
            event: params.event,
            partnerId: settlement.partnerId,
            amount: settlement.netPayableAmount.toFixed(4),
            reason,
          },
        },
        tx,
      );
      return tx.partnerSettlement.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * One row per try at moving the money.
   *
   * Three outcomes, and the difference between the last two is the whole
   * reason this table exists:
   *
   * - `succeeded` — the money left. Carries the bank's reference and the
   *   success key, and the database refuses to change it afterwards.
   * - `failed` — resolved, and the answer was no. `resolvedAt` is set.
   * - `unresolved` — nobody knows. `resolvedAt` stays null, which is the
   *   mark of an attempt that might have moved money.
   *
   * When an ambiguous attempt is later resolved by a human, the *same* row is
   * updated rather than a new one written: the bank reference is unique
   * across attempts, so re-inserting it would collide, and more importantly
   * the history should read "this attempt turned out to have worked", not
   * "some attempt failed and a different one worked".
   */
  private async recordAttempt(
    tx: Tx,
    settlement: { id: string; netPayableAmount: Decimal; currency: Currency },
    params: {
      actorId: string;
      outcome: 'succeeded' | 'failed' | 'unresolved';
      reason?: string;
      bankTransferReference?: string;
    },
  ) {
    const succeeded = params.outcome === 'succeeded';
    const reference = params.bankTransferReference?.trim() || null;
    const data = {
      succeeded,
      failureReason: succeeded ? null : (params.reason ?? null),
      successKey: succeeded ? TRANSFER_SUCCESS_KEY : null,
      bankTransferReference: reference,
      attemptedByUserId: params.actorId,
      resolvedAt: params.outcome === 'unresolved' ? null : new Date(),
    };

    if (reference) {
      const resolved = await tx.partnerSettlementTransferAttempt.updateMany({
        where: {
          settlementId: settlement.id,
          bankTransferReference: reference,
          succeeded: false,
          resolvedAt: null,
        },
        data,
      });
      if (resolved.count > 0) return;
    }

    await tx.partnerSettlementTransferAttempt.create({
      data: {
        ...data,
        settlementId: settlement.id,
        // The database checks both against the settlement; passing anything
        // else here is caught rather than stored.
        amount: settlement.netPayableAmount,
        currency: settlement.currency,
      },
    });
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  async list(filter: { partnerId?: string } = {}) {
    return this.prisma.partnerSettlement.findMany({
      where: filter.partnerId ? { partnerId: filter.partnerId } : {},
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { _count: { select: { entries: true } } },
    });
  }

  async detail(id: string) {
    const settlement = await this.prisma.partnerSettlement.findUnique({
      where: { id },
      include: {
        entries: { orderBy: { occurredAt: 'asc' } },
        transferAttempts: { orderBy: { attemptedAt: 'asc' } },
        bankAccount: true,
      },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    return settlement;
  }

  /**
   * Which branch each statement line came from, resolved in two queries for
   * the whole statement rather than one per line.
   *
   * Only two source types can answer: a purchase (`PurchaseIntent`) and an
   * operation row (`Transaction`), both of which carry `partnerBranchId`.
   * Everything else on a statement — a payout, a collection, the settlement
   * itself, a commission line — is not a sale and has no branch, so it stays
   * null rather than being attributed to one.
   *
   * The name is read live, not snapshotted, exactly as `TransactionDto.branch`
   * documents: renaming a branch renames it on last month's statement too.
   * A statement a partner has already agreed to therefore stays correct in
   * its figures, which are what the agreement is about, while its branch
   * labels follow the current names.
   */

  /**
   * Where one purchase's effect on the debt comes from.
   *
   * The screen above this answers "why do you owe me this much" with a list
   * of days and amounts. This answers the next question, which a partner
   * asks about one line: *this* sale, what it was, who took the money, what
   * TuTak's share of it was, and what is left owing on it.
   *
   * Built from the ledger rather than recomputed from the purchase's own
   * columns. The postings are what the debt actually is; a second
   * calculation over `grossAmount` and the rate would be a number that
   * agrees with the first one right up until it does not.
   *
   * ## What it deliberately does not say
   *
   * TuTak's own economics. A purchase carries the pool split — the
   * customer's points, the deferred part, three levels of referral and
   * TuTak's residual — and none of it is the partner's business: it is what
   * the platform does with its own share after the partner's contractual
   * deduction. The partner sees their own deduction, in full, because that
   * is the number they signed and the one they check. Everything past it
   * stays inside.
   */
  async purchaseBreakdown(partnerId: string, purchaseIntentId: string) {
    const intent = await this.prisma.purchaseIntent.findFirst({
      where: { id: purchaseIntentId, partnerId },
      select: {
        id: true,
        confirmationCode: true,
        confirmedAt: true,
        grossAmount: true,
        bonusAmountRequested: true,
        prepaidAmountApplied: true,
        ordinaryPaymentRemainder: true,
        refundedAmount: true,
        paymentRoute: true,
        confirmationSource: true,
        confirmedByEmployeeCode: true,
        partnerBranchId: true,
        status: true,
      },
    });
    // Same answer for "not yours" and "no such purchase": the partner id is
    // in the query rather than checked afterwards, so another partner's id
    // cannot be confirmed by the shape of the refusal.
    if (!intent) throw new NotFoundException('Purchase not found');

    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
      select: { id: true },
    });

    const postings = account
      ? await this.prisma.ledgerPosting.findMany({
          where: {
            accountId: account.id,
            transaction: { sourceType: 'PurchaseIntent', sourceId: purchaseIntentId },
          },
          select: {
            id: true,
            amount: true,
            direction: true,
            transaction: { select: { kind: true, postedAt: true } },
            settlementEntry: {
              select: { settlement: { select: { id: true, status: true, paidAt: true } } },
            },
          },
          orderBy: { id: 'asc' },
        })
      : [];

    const zero = new Decimal(0);
    let owed = zero;
    let settled = zero;
    let reserved = zero;

    const lines = postings.map((posting) => {
      const signed =
        posting.direction === PostingDirection.CREDIT
          ? new Decimal(posting.amount)
          : new Decimal(posting.amount).negated();
      owed = owed.plus(signed);

      const settlement = posting.settlementEntry?.settlement ?? null;
      // Three places one line's money can be, and they do not overlap: still
      // owing, held by a settlement nobody has paid yet, or paid. A screen
      // that showed the middle one as "paid" would be telling a partner a
      // transfer happened when a draft was written.
      const state =
        settlement === null
          ? 'UNSETTLED'
          : settlement.status === PartnerSettlementStatus.PAID
            ? 'PAID'
            : 'IN_SETTLEMENT';
      if (state === 'PAID') settled = settled.plus(signed);
      if (state === 'IN_SETTLEMENT') reserved = reserved.plus(signed);

      return {
        kind: posting.transaction.kind,
        amount: signed.toFixed(4),
        occurredAt: posting.transaction.postedAt.toISOString(),
        state,
        settlementId: settlement?.id ?? null,
      };
    });

    const refunds = await this.prisma.purchaseIntentRefund.findMany({
      where: { purchaseIntentId },
      select: { id: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      purchaseIntentId: intent.id,
      confirmationCode: intent.confirmationCode,
      confirmedAt: intent.confirmedAt?.toISOString() ?? null,
      status: intent.status,
      branchId: intent.partnerBranchId,
      /** Who or what confirmed it, as the statement line shows it. */
      confirmationSource: intent.confirmationSource,
      employeeCode: intent.confirmedByEmployeeCode,
      /** What the customer bought, and how the three parts of it were funded. */
      grossAmount: intent.grossAmount.toFixed(4),
      bonusApplied: intent.bonusAmountRequested.toFixed(4),
      prepaidApplied: intent.prepaidAmountApplied.toFixed(4),
      externalAmount: intent.ordinaryPaymentRemainder.toFixed(4),
      paymentRoute: intent.paymentRoute,
      /**
       * Who ended up holding the money the customer paid outside their TuTak
       * balances — the partner's own till, or TuTak through the provider.
       * The distinction is the whole reason a partner is owed anything on a
       * provider sale and nothing extra on a till sale.
       */
      externalCollectedBy:
        intent.paymentRoute === PaymentRoute.DIRECT_PARTNER ? 'PARTNER_TILL' : 'TUTAK_VIA_PROVIDER',
      refundedAmount: intent.refundedAmount.toFixed(4),
      refunds: refunds.map((refund) => ({
        id: refund.id,
        amount: refund.amount.toFixed(4),
        occurredAt: refund.createdAt.toISOString(),
      })),
      /** Every ledger line this purchase put on the partner's payable. */
      lines,
      /** What the purchase did to the debt in total, and where that money stands now. */
      effectOnDebt: owed.toFixed(4),
      stillOwed: owed.minus(settled).minus(reserved).toFixed(4),
      inOpenSettlement: reserved.toFixed(4),
      paid: settled.toFixed(4),
    };
  }


  /**
   * Every movement on this partner's payable, filtered and paged.
   *
   * ## Why this is not the statement list
   *
   * A statement answers "what was in the transfer you sent me". This answers
   * the question that comes before it — "where did this figure come from" —
   * and it has to cover the movements no statement has claimed yet, the ones
   * a draft is holding, and the payouts themselves. So it reads the payable
   * account's postings directly, which is also what makes it agree with the
   * position tiles by construction rather than by a second arithmetic.
   *
   * Nothing is excluded by kind. An unclassified posting is money whose side
   * nobody has decided, and dropping it here would make the list quietly
   * disagree with the ledger balance above it — see `unrecognisedKinds`.
   *
   * ## Paging that does not lie under a moving list
   *
   * Keyset, on `(postedAt, id)` descending, never `OFFSET`. New postings
   * arrive on this account while a partner is reading page three, and with
   * an offset that means rows shifting across page boundaries — a line read
   * twice, or, worse, one never read at all. `(postedAt, id)` is unique
   * because `id` is, so the order is total and a cursor names exactly one
   * row. A row-value comparison does the seek in one index-friendly
   * predicate rather than the three-way OR people write by hand and get
   * wrong at the tie.
   *
   * ## The selection totals are the selection's
   *
   * `selection` sums what the filter selected and says how many rows that
   * is. It is deliberately a separate object from anything in `position()`:
   * "the six sales at this branch in March net to 18 000" is not a statement
   * about what TuTak owes the organisation, and a screen that lets those two
   * numbers look like the same kind of thing invites a partner to read a
   * filtered subtotal as their balance.
   */
  async activity(
    partnerId: string,
    opts: {
      from?: Date;
      to?: Date;
      branchId?: string;
      state?: ActivityState;
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<PartnerActivityPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    // Before the account lookup, not after. A cursor the client did not get
    // from us is a bug in the client either way, and on a partner with no
    // postings yet the early return below would have answered it with an
    // empty page — a refusal that looks exactly like "you have no activity".
    const cursor = decodeCursor(opts.cursor);
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId },
      select: { id: true },
    });
    if (!account) {
      return {
        rows: [],
        nextCursor: null,
        selection: { credits: '0.0000', debits: '0.0000', net: '0.0000', rowCount: 0 },
        filtered: isFiltered(opts),
      };
    }

    const where = this.activityWhere(account.id, opts);
    // `::timestamp` against an offset-free literal, never a bound `Date`.
    // `postedAt` is `TIMESTAMP(3)` without a time zone, and comparing it
    // with a `timestamptz` parameter makes PostgreSQL convert the column
    // through the session's time zone — so the same cursor would seek to a
    // different row on a server whose TZ is not UTC. See `stamp()`.
    const seek = cursor
      ? Prisma.sql`AND (t."postedAt", p."id") < (${cursor.postedAt}::timestamp, ${cursor.id})`
      : Prisma.empty;

    const raw = await this.prisma.$queryRaw<ActivityRawRow[]>`
      SELECT p."id", p."amount", p."direction"::text AS "direction",
             t."kind", t."sourceType", t."sourceId", t."postedAt",
             e."settlementId", s."status"::text AS "settlementStatus"
      FROM "ledger_postings" p
      JOIN "ledger_transactions" t ON t."id" = p."transactionId"
      LEFT JOIN "partner_settlement_entries" e ON e."ledgerPostingId" = p."id"
      LEFT JOIN "partner_settlements" s ON s."id" = e."settlementId"
      WHERE ${where}
      ${seek}
      ORDER BY t."postedAt" DESC, p."id" DESC
      LIMIT ${limit + 1}`;

    // The totals belong to the filter, not to the page: a partner who
    // filters to one branch wants that branch's six months, not the fifty
    // rows that happened to fit on screen. So the cursor is deliberately
    // absent from this query.
    const [totals] = await this.prisma.$queryRaw<
      { credits: Decimal | null; debits: Decimal | null; rows: bigint }[]
    >`
      SELECT
        SUM(CASE WHEN p."direction" = 'CREDIT' THEN p."amount" ELSE 0 END) AS "credits",
        SUM(CASE WHEN p."direction" = 'DEBIT' THEN p."amount" ELSE 0 END) AS "debits",
        COUNT(*) AS "rows"
      FROM "ledger_postings" p
      JOIN "ledger_transactions" t ON t."id" = p."transactionId"
      LEFT JOIN "partner_settlement_entries" e ON e."ledgerPostingId" = p."id"
      LEFT JOIN "partner_settlements" s ON s."id" = e."settlementId"
      WHERE ${where}`;

    const page = raw.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      raw.length > limit && last ? encodeCursor(last.postedAt, last.id) : null;

    const sources = page.map((row) => ({ sourceType: row.sourceType, sourceId: row.sourceId }));
    const [branchBySource, purchaseFacts] = await Promise.all([
      this.branchesForEntries(sources),
      this.purchaseFactsFor(sources),
    ]);

    const credits = new Decimal(totals?.credits ?? 0);
    const debits = new Decimal(totals?.debits ?? 0);

    return {
      rows: page.map((row) => {
        // CREDIT on a payable raises what TuTak owes; DEBIT lowers it. The
        // sign is the whole content of the column a partner reads, so it is
        // computed here once rather than in each client.
        const signed =
          row.direction === PostingDirection.CREDIT
            ? new Decimal(row.amount)
            : new Decimal(row.amount).negated();
        const facts = purchaseFacts.get(row.sourceId) ?? null;
        return {
          postingId: row.id,
          occurredAt: row.postedAt.toISOString(),
          kind: row.kind,
          /** What this line did to the debt, signed. */
          debtChange: signed.toFixed(4),
          state: stateOf(row.settlementStatus),
          settlementId: row.settlementId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          /**
           * What a partner quotes when they query this line. The purchase's
           * own uuid is the only stable identifier it has — the four-digit
           * confirmation code returns to the pool the moment the purchase
           * ends, so it names nothing a day later. Shortened to the last
           * eight characters because that is what fits on a row and what a
           * person can read out; `sourceId` above is the whole of it.
           */
          reference: reference(row.sourceId),
          /**
           * The branch, by name only. The organisation is the one the
           * partner is already looking at, and repeating the whole
           * organisation → branch chain on every row buries the figures the
           * row exists to show.
           */
          branch: branchBySource.get(`${row.sourceType}:${row.sourceId}`)?.name ?? null,
          /**
           * The factual source of the line. For a sale that is the person's
           * permanent employee code as frozen at confirmation; for a
           * provider or integration confirmation there is no person and the
           * source says so rather than naming one.
           */
          employeeCode: facts?.employeeCode ?? null,
          confirmationSource: facts?.confirmationSource ?? null,
          /** Whether `purchaseBreakdown` can itemise this line further. */
          itemisable: row.sourceType === 'PurchaseIntent',
        };
      }),
      nextCursor,
      selection: {
        credits: credits.toFixed(4),
        debits: debits.toFixed(4),
        net: credits.minus(debits).toFixed(4),
        rowCount: Number(totals?.rows ?? 0),
      },
      /** True when the totals above describe less than the whole account. */
      filtered: isFiltered(opts),
    };
  }

  /** The filter, shared by the page query and the selection totals so the
      two can never disagree about what was selected. */
  private activityWhere(
    accountId: string,
    opts: { from?: Date; to?: Date; branchId?: string; state?: ActivityState },
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`p."accountId" = ${accountId}`];
    if (opts.from) parts.push(Prisma.sql`t."postedAt" >= ${stamp(opts.from)}::timestamp`);
    if (opts.to) parts.push(Prisma.sql`t."postedAt" <= ${stamp(opts.to)}::timestamp`);
    if (opts.branchId) {
      // The branch lives on the source row, not on the posting. A subquery
      // rather than a post-filter in TypeScript: filtering after the page
      // was fetched would return short pages and a cursor that skips rows.
      parts.push(Prisma.sql`(
        (t."sourceType" = 'PurchaseIntent' AND t."sourceId" IN (
          SELECT "id" FROM "purchase_intents" WHERE "partnerBranchId" = ${opts.branchId}))
        OR (t."sourceType" = 'Transaction' AND t."sourceId" IN (
          SELECT "id" FROM "transactions" WHERE "partnerBranchId" = ${opts.branchId}))
      )`);
    }
    if (opts.state === 'UNSETTLED') parts.push(Prisma.sql`e."id" IS NULL`);
    if (opts.state === 'IN_SETTLEMENT') {
      parts.push(
        Prisma.sql`s."status"::text IN ('DRAFT','READY','APPROVED','PAYMENT_PENDING','FAILED')`,
      );
    }
    if (opts.state === 'UNDER_REVIEW') {
      parts.push(Prisma.sql`s."status"::text = 'REQUIRES_RECONCILIATION'`);
    }
    if (opts.state === 'PAID') parts.push(Prisma.sql`s."status"::text = 'PAID'`);
    return Prisma.join(parts, ' AND ');
  }

  /**
   * Who or what confirmed each purchase behind these lines, read from the
   * purchase's own frozen columns.
   *
   * Frozen, not joined through to the employee: `confirmedByEmployeeCode` is
   * what the row said on the day, and resolving the person's code now would
   * make last month's statement follow this month's transfers between
   * branches. A row that predates the column returns nulls, and the
   * interface says "not recorded" — it does not guess.
   */
  private async purchaseFactsFor(
    sources: { sourceType: string; sourceId: string }[],
  ): Promise<Map<string, { employeeCode: string | null; confirmationSource: string | null }>> {
    const ids = [
      ...new Set(sources.filter((s) => s.sourceType === 'PurchaseIntent').map((s) => s.sourceId)),
    ];
    if (ids.length === 0) return new Map();
    const intents = await this.prisma.purchaseIntent.findMany({
      where: { id: { in: ids } },
      select: { id: true, confirmedByEmployeeCode: true, confirmationSource: true },
    });
    return new Map(
      intents.map((intent) => [
        intent.id,
        {
          employeeCode: intent.confirmedByEmployeeCode,
          confirmationSource: intent.confirmationSource,
        },
      ]),
    );
  }

  private async branchesForEntries(
    entries: { sourceType: string; sourceId: string }[],
  ): Promise<Map<string, { id: string; name: string; address: string }>> {
    const idsOf = (sourceType: string) =>
      entries.filter((e) => e.sourceType === sourceType).map((e) => e.sourceId);
    const intentIds = idsOf('PurchaseIntent');
    const transactionIds = idsOf('Transaction');
    if (intentIds.length === 0 && transactionIds.length === 0) return new Map();

    const [intents, transactions] = await Promise.all([
      intentIds.length
        ? this.prisma.purchaseIntent.findMany({
            where: { id: { in: intentIds } },
            select: { id: true, partnerBranchId: true },
          })
        : Promise.resolve([]),
      transactionIds.length
        ? this.prisma.transaction.findMany({
            where: { id: { in: transactionIds } },
            select: { id: true, partnerBranchId: true },
          })
        : Promise.resolve([]),
    ]);

    // Keyed by source type as well as id, not by the caller's own row id:
    // a settled statement line has one and a not-yet-settled posting does
    // not, and both need this lookup. Both ids are uuids and a collision is
    // not a practical worry, but a key that cannot mix a purchase with a
    // transaction is one fewer thing to reason about.
    const branchIdBySource = new Map<string, string>();
    for (const row of intents) {
      if (row.partnerBranchId) branchIdBySource.set(`PurchaseIntent:${row.id}`, row.partnerBranchId);
    }
    for (const row of transactions) {
      if (row.partnerBranchId) branchIdBySource.set(`Transaction:${row.id}`, row.partnerBranchId);
    }
    if (branchIdBySource.size === 0) return new Map();

    const branches = await this.prisma.partnerBranch.findMany({
      where: { id: { in: [...new Set(branchIdBySource.values())] } },
      select: { id: true, name: true, address: true },
    });
    const branchById = new Map(branches.map((b) => [b.id, b]));

    const bySource = new Map<string, { id: string; name: string; address: string }>();
    for (const [key, branchId] of branchIdBySource) {
      const branch = branchById.get(branchId);
      if (branch) bySource.set(key, branch);
    }
    return bySource;
  }

  /**
   * A partner's own statement: opening, what moved, closing, itemised.
   *
   * The itemisation is the point. A partner told "we owe you 14,500" has no
   * way to agree or disagree; a partner shown the purchases, the refunds and
   * the commission that make up 14,500 can check it against their till. Each
   * line keeps the `kind` and the source row it came from, so "why" is
   * answerable down to the individual sale.
   *
   * Opening and closing are derived from the claimed postings rather than
   * stored: a stored balance is a second source of truth, and the whole
   * design rests on the ledger being the only one.
   */
  async partnerStatement(id: string, partnerId: string) {
    const settlement = await this.prisma.partnerSettlement.findUnique({
      where: { id },
      include: {
        entries: { orderBy: { occurredAt: 'asc' } },
        transferAttempts: { orderBy: { attemptedAt: 'asc' } },
      },
    });
    // Not "forbidden": a partner should not learn that another partner's
    // settlement exists by being told they may not see it.
    if (!settlement || settlement.partnerId !== partnerId) {
      throw new NotFoundException('Settlement not found');
    }

    const accrued = settlement.entries
      .filter((e) => e.direction === PostingDirection.CREDIT)
      .reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
    const deducted = settlement.entries
      .filter((e) => e.direction === PostingDirection.DEBIT)
      .reduce((sum, e) => sum.plus(e.amount), new Decimal(0));

    const branchByEntry = await this.branchesForEntries(settlement.entries);

    return {
      id: settlement.id,
      status: settlement.status,
      currency: settlement.currency,
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      /** What the platform owed for in this period. */
      accrued: accrued.toFixed(4),
      /** Commission, refund reversals, and debt carried in. */
      deducted: deducted.toFixed(4),
      /** accrued − deducted. What the transfer is for. */
      netPayable: settlement.netPayableAmount.toFixed(4),
      documentNumber: settlement.documentNumber,
      paidAt: settlement.paidAt,
      bankTransferReference: settlement.bankTransferReference,
      /** Every line, with what produced it. */
      entries: settlement.entries.map((entry) => ({
        occurredAt: entry.occurredAt,
        kind: entry.kind,
        direction: entry.direction,
        amount: entry.amount.toFixed(4),
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        /** Which of the partner's own shops the sale came from, where the
            source records one — see `branchesForEntries`. */
        branch: branchByEntry.get(`${entry.sourceType}:${entry.sourceId}`) ?? null,
      })),
      /** Every try at moving it, including the ones that bounced. */
      transferAttempts: settlement.transferAttempts.map((attempt) => ({
        attemptedAt: attempt.attemptedAt,
        succeeded: attempt.succeeded,
        bankTransferReference: attempt.bankTransferReference,
        failureReason: attempt.failureReason,
        /** Null while nobody knows — an ambiguous result, not a failure. */
        resolvedAt: attempt.resolvedAt,
      })),
    };
  }

  /** The shared shape of the simple status moves. */
  private async transition(
    id: string,
    params: {
      from: PartnerSettlementStatus[];
      to: PartnerSettlementStatus;
      actorId: string;
      data: Prisma.PartnerSettlementUpdateManyMutationInput;
      event: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerSettlement.updateMany({
        where: { id, status: { in: params.from } },
        data: { ...params.data, status: params.to },
      });
      if (claimed.count === 0) {
        const current = await tx.partnerSettlement.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!current) throw new NotFoundException('Settlement not found');
        throw new ConflictException(
          `Settlement is ${current.status}; expected one of ${params.from.join(', ')}`,
        );
      }
      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerSettlement',
          entityId: id,
          metadata: { event: params.event },
        },
        tx,
      );
      return tx.partnerSettlement.findUniqueOrThrow({ where: { id } });
    });
  }
}

/**
 * Where one movement's money stands. The same four names the position tiles
 * use, so a row and a tile cannot describe the same amount differently.
 *
 * A cancelled settlement is deliberately absent: cancelling deletes its
 * claims, which is what releases the postings, so those rows read
 * `UNSETTLED` again — which is what they are.
 */
export type ActivityState = 'UNSETTLED' | 'IN_SETTLEMENT' | 'UNDER_REVIEW' | 'PAID';

interface ActivityRawRow {
  id: string;
  amount: Decimal;
  direction: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  postedAt: Date;
  settlementId: string | null;
  settlementStatus: string | null;
}

/** One line of the partner's own account, as they read it. */
export interface PartnerActivityRow {
  postingId: string;
  occurredAt: string;
  kind: string;
  debtChange: string;
  state: ActivityState;
  settlementId: string | null;
  sourceType: string;
  sourceId: string;
  reference: string;
  branch: string | null;
  employeeCode: string | null;
  confirmationSource: string | null;
  itemisable: boolean;
}

export interface PartnerActivityPage {
  rows: PartnerActivityRow[];
  /** Opaque. Pass it back to continue; null means this was the last page. */
  nextCursor: string | null;
  /**
   * What the *filter* selected — never the organisation's position. See
   * `activity`'s docblock for why these are kept apart.
   */
  selection: { credits: string; debits: string; net: string; rowCount: number };
  filtered: boolean;
}

function stateOf(status: string | null): ActivityState {
  if (status === null) return 'UNSETTLED';
  if (status === PartnerSettlementStatus.PAID) return 'PAID';
  if (status === PartnerSettlementStatus.REQUIRES_RECONCILIATION) return 'UNDER_REVIEW';
  return 'IN_SETTLEMENT';
}

/** The short form of a source id, for quoting a line back to TuTak. */
function reference(sourceId: string): string {
  return sourceId.replace(/-/g, '').slice(-8).toUpperCase();
}

/** An offset-free literal for a `TIMESTAMP(3)` column — see the seek clause. */
function stamp(value: Date): string {
  return value.toISOString().replace('Z', '');
}

function encodeCursor(postedAt: Date, id: string): string {
  return Buffer.from(`${stamp(postedAt)}|${id}`, 'utf8').toString('base64url');
}

/**
 * A cursor the client did not get from us is refused, not ignored.
 *
 * Ignoring it would silently restart the list at the top, and a client
 * paging through a statement would loop over the first page for ever
 * without anything looking wrong.
 */
function decodeCursor(raw?: string): { postedAt: string; id: string } | null {
  if (!raw) return null;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const at = decoded.indexOf('|');
  const postedAt = decoded.slice(0, at);
  const id = decoded.slice(at + 1);
  if (at < 0 || !/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(postedAt) || id.length === 0) {
    throw new BadRequestException('Invalid cursor');
  }
  return { postedAt, id };
}

function isFiltered(opts: { from?: Date; to?: Date; branchId?: string; state?: ActivityState }) {
  return Boolean(opts.from || opts.to || opts.branchId || opts.state);
}
