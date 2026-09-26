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
  PostingDirection,
  Prisma,
  ReconciliationOutcome,
  ReconciliationSource,
  SettlementPeriodicity,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  SETTLEABLE_LEDGER_KINDS,
  SETTLEMENT_PAID_KIND,
  unrecognisedKinds,
} from './settleable-kinds';
import { SettlementPeriodBounds, lastClosedPeriod, normaliseAnchorDay } from './settlement-period';

type Tx = Prisma.TransactionClient;

/**
 * The states a bank transfer may be attempted from.
 *
 * `FAILED` is in the list deliberately. A settlement is the statement of what
 * a partner is owed; a bank refusing to move the money does not change what
 * is owed, it only means nobody has moved it yet. Treating `FAILED` as
 * terminal stranded the claimed postings for ever — the bug Arman's review of
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

/**
 * A settlement in one of these states has committed the money it claimed:
 * approved for transfer, being transferred, transferred, or waiting on a
 * person to say whether a transfer happened. A DRAFT or READY one has not —
 * it can still be cancelled, which releases its claims.
 */
export const COMMITTED_SETTLEMENT_STATUSES: readonly PartnerSettlementStatus[] = [
  PartnerSettlementStatus.APPROVED,
  PartnerSettlementStatus.PAYMENT_PENDING,
  PartnerSettlementStatus.PAID,
  PartnerSettlementStatus.FAILED,
  PartnerSettlementStatus.REQUIRES_RECONCILIATION,
];

/**
 * Serialises everything that decides what a partner's settlement contains:
 * a draft claiming postings, and a Partner Commerce dispute deciding whether
 * to freeze an order's credit (`OrderDisputesService.open`). Without it a
 * dispute could post its hold a moment after a draft read the unclaimed
 * postings, and the disputed amount would be paid in that draft.
 */
export async function lockPartnerForSettlement(tx: Tx, partnerId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "partners" WHERE id = ${partnerId} FOR UPDATE`;
}

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
 * Arman's decision of 14.09.2026, and this engine only records that it
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
      where: {
        accountId: account.id,
        settlementEntry: null,
        ...(opts.until ? { transaction: { postedAt: { lte: opts.until } } } : {}),
      },
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
      if (!SETTLEABLE_LEDGER_KINDS.has(posting.transaction.kind)) continue;
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
   * Claims everything settleable up to `periodEnd` into a new DRAFT.
   *
   * Refuses a non-positive net rather than creating a settlement for it. That
   * is not squeamishness: claiming a negative balance would *consume* the
   * postings that represent the partner's debt, and the debt has to stay
   * unclaimed so the next period picks it up and offsets it against new
   * earnings — which is exactly what Arman asked for.
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
      await lockPartnerForSettlement(tx, params.partnerId);
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

  /**
   * The most recent period of this partner's own cadence that has ended at
   * `now` — `Partner.settlementPeriodicity` + `settlementAnchorDay`, the one
   * authoritative cadence (docs/PARTNER_COMMERCE.md §14).
   */
  async closedPeriodFor(partnerId: string, now = new Date()): Promise<SettlementPeriodBounds> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { settlementPeriodicity: true, settlementAnchorDay: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return lastClosedPeriod(partner.settlementPeriodicity, partner.settlementAnchorDay, now);
  }

  /**
   * A draft for the partner's last closed period: claims everything
   * settleable posted before its end, exactly like `createDraft` with that
   * period — the cadence only picks the dates.
   */
  async createDraftForClosedPeriod(params: { partnerId: string; actorId: string; now?: Date }) {
    const period = await this.closedPeriodFor(params.partnerId, params.now);
    return this.createDraft({
      partnerId: params.partnerId,
      actorId: params.actorId,
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  /**
   * A platform admin sets a partner's settlement cadence. Audited as
   * PARTNER_SETTLEMENT_PERIOD_CHANGED — the same action the retired Partner
   * Commerce `settlementPeriod` setter used, so one audit trail covers both.
   */
  async setPeriodicity(params: {
    partnerId: string;
    periodicity: SettlementPeriodicity;
    anchorDay?: number;
    actorId: string;
  }) {
    if (!Object.values(SettlementPeriodicity).includes(params.periodicity)) {
      throw new BadRequestException('Unknown settlement periodicity');
    }
    const anchorDay = normaliseAnchorDay(params.periodicity, params.anchorDay);
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({
        where: { id: params.partnerId },
        select: { settlementPeriodicity: true, settlementAnchorDay: true },
      });
      if (!partner) throw new NotFoundException('Partner not found');
      const updated = await tx.partner.update({
        where: { id: params.partnerId },
        data: { settlementPeriodicity: params.periodicity, settlementAnchorDay: anchorDay },
        select: { id: true, settlementPeriodicity: true, settlementAnchorDay: true },
      });
      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_SETTLEMENT_PERIOD_CHANGED,
          entityType: 'Partner',
          entityId: params.partnerId,
          metadata: {
            from: { periodicity: partner.settlementPeriodicity, anchorDay: partner.settlementAnchorDay },
            to: { periodicity: updated.settlementPeriodicity, anchorDay: updated.settlementAnchorDay },
          },
        },
        tx,
      );
      return {
        partnerId: updated.id,
        settlementPeriodicity: updated.settlementPeriodicity,
        settlementAnchorDay: updated.settlementAnchorDay,
      };
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

      /*
       * A Partner Commerce dispute opened after this draft was cut froze part
       * of an order credit the draft already claimed. Its hold posting is a
       * deduction this draft does not contain, so approving would pay the
       * disputed amount. Refused: cancel and redraft, and the new draft nets
       * the credit against its hold (docs/PARTNER_COMMERCE.md §14). Under the
       * same partner lock `OrderDisputesService.open` takes.
       */
      await lockPartnerForSettlement(tx, settlement.partnerId);
      const disputed = await tx.$queryRaw<{ orderId: string }[]>`
        SELECT DISTINCT d."orderId"
          FROM partner_settlement_entries e
          JOIN order_disputes d
            ON d."orderId" = e."sourceId" AND d.status = 'OPEN' AND d."holdLedgerTransactionId" IS NOT NULL
         WHERE e."settlementId" = ${id}
           AND e.kind = 'partner_order.completion'
           AND e."sourceType" = 'PartnerOrder'
           AND NOT EXISTS (
             SELECT 1 FROM ledger_postings hp
               JOIN partner_settlement_entries he ON he."ledgerPostingId" = hp.id
              WHERE hp."transactionId" = d."holdLedgerTransactionId" AND he."settlementId" = ${id}
           )`;
      if (disputed.length > 0) {
        throw new ConflictException({
          message:
            `An order in this settlement has an open dispute whose frozen amount is not in it ` +
            `(${disputed.map((d) => d.orderId).join(', ')}). Cancel this settlement and draft it again.`,
          error: 'OPEN_DISPUTE_NOT_IN_SETTLEMENT',
        });
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
   * It used to be terminal. That was a real bug, found in Arman's review of
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
   * it is a different act by a different kind of person. Arman's decision of
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
   * This is the **proposal**, and on its own it moves nothing. Arman's
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
