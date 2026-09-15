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
      return { partnerId, accrued: zero, deductions: zero, net: zero, entries: [], unrecognised: [] };
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
    params: { actorId: string; documentNumber?: string; documentDate?: Date; documentReference?: string },
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

      const [payableAccount, bankAccount] = await Promise.all([
        this.ledger.accountFor({
          type: LedgerAccountType.PARTNER_PAYABLE,
          partnerId: settlement.partnerId,
        }),
        this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_BANK }),
      ]);

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
   * how a partner gets paid twice.
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
   * `resolveReconciliation` with what it actually says.
   */
  async markRequiresReconciliation(
    id: string,
    params: { actorId: string; reason: string; bankTransferReference?: string },
  ) {
    return this.recordOutcome(id, {
      actorId: params.actorId,
      reason: params.reason,
      bankTransferReference: params.bankTransferReference,
      to: PartnerSettlementStatus.REQUIRES_RECONCILIATION,
      outcome: 'unresolved',
      event: 'settlement.requires_reconciliation',
    });
  }

  /**
   * A human has read the bank statement and knows which way the ambiguous
   * attempt went.
   *
   * `money-moved` closes the settlement exactly as `markPaid` would, posting
   * once. `money-did-not-move` returns it to the retryable `FAILED` state.
   * There is no third answer: "still not sure" means leave it alone.
   */
  async resolveReconciliation(
    id: string,
    params:
      | { actorId: string; outcome: 'money-moved'; bankTransferReference: string }
      | { actorId: string; outcome: 'money-did-not-move'; reason: string },
  ) {
    const settlement = await this.prisma.partnerSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== PartnerSettlementStatus.REQUIRES_RECONCILIATION) {
      throw new ConflictException(
        `Settlement is ${settlement.status}; only one awaiting reconciliation can be resolved`,
      );
    }

    if (params.outcome === 'money-moved') {
      return this.payFrom(id, {
        actorId: params.actorId,
        bankTransferReference: params.bankTransferReference,
        from: [PartnerSettlementStatus.REQUIRES_RECONCILIATION],
        event: 'settlement.reconciled_paid',
      });
    }

    return this.recordOutcome(id, {
      actorId: params.actorId,
      reason: params.reason,
      to: PartnerSettlementStatus.FAILED,
      outcome: 'failed',
      event: 'settlement.reconciled_failed',
      from: [PartnerSettlementStatus.REQUIRES_RECONCILIATION],
    });
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
        data: { status: params.to, failedReason: reason },
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
