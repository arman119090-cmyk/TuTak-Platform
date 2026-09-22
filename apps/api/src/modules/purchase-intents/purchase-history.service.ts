import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ExternalRefundStatus,
  PurchaseConfirmationSource,
  PurchaseIntentStatus,
  PspAttemptStatus,
  RefundRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Who did a thing, as a partner may be told about it.
 *
 * A union rather than a user id, for the same reason the confirmation view
 * is one: a partner's screens name people by their code, and handing out
 * raw ids invites a client to join them against something it should not be
 * reading. The two `STAFF` shapes are deliberately different:
 *
 *  - `frozen: true` is what the purchase row itself recorded on the day.
 *    It is history and it never changes, even if the person has since moved
 *    branch, changed role or left.
 *  - `frozen: false` is a code looked up *now*, for a fact that was stored
 *    with nothing but a user id — a refund, a refund decision. It is the
 *    person's permanent code, so it still identifies the right human, but
 *    it is what the payroll says today and is labelled as such.
 *
 * `NOT_RECORDED` is for rows that predate the column that would have said.
 * It is never turned into a name: a purchase confirmed before the
 * confirmation source existed has no actor on record, and inventing one is
 * the specific failure this union exists to prevent.
 */
export type HistoryActor =
  | { kind: 'CUSTOMER' }
  | { kind: 'STAFF'; employeeCode: string; role: string | null; frozen: true }
  /**
   * `employeeCode` is null for somebody on this partner's payroll who has
   * never been issued a permanent code — an owner who has never confirmed
   * a sale, for instance. Still their business's own person, which is why
   * this is not `TUTAK`.
   */
  | { kind: 'STAFF'; employeeCode: string | null; frozen: false }
  | { kind: 'INTEGRATION'; apiKeyId: string }
  /** `provider` is null when the row records that a callback did it but
      not which provider's — no attempt row names one. */
  | { kind: 'PROVIDER'; provider: string | null }
  /** Somebody at TuTak, not on this partner's payroll. Never named further. */
  | { kind: 'TUTAK' }
  /** Nobody acted — a deadline passed. */
  | { kind: 'SYSTEM' }
  | { kind: 'NOT_RECORDED' };

export type HistoryEventType =
  | 'CREATED'
  | 'MERCHANT_APPROVED'
  | 'PROVIDER_PAYMENT_STARTED'
  | 'PROVIDER_PAYMENT_CONFIRMED'
  | 'PROVIDER_PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUND_REQUESTED'
  | 'REFUND_REQUEST_REJECTED'
  | 'REFUNDED'
  | 'EXTERNAL_REFUND_CONFIRMED';

export interface HistoryEvent {
  type: HistoryEventType;
  at: string;
  actor: HistoryActor;
  /** Only what the event itself recorded. Never a reconstruction. */
  detail: Record<string, string | null>;
}

export interface PurchaseHistory {
  purchaseIntentId: string;
  reference: string;
  status: PurchaseIntentStatus;
  events: HistoryEvent[];
}

/**
 * Deterministic order for events sharing a timestamp.
 *
 * Two facts can land in the same millisecond — a provider callback that
 * confirms the payment and the confirmation it causes — and a list whose
 * order changes between two reads of the same purchase is a list nobody can
 * reconcile against anything. The rank is the order things can happen in.
 */
const ORDER: Record<HistoryEventType, number> = {
  CREATED: 0,
  MERCHANT_APPROVED: 1,
  PROVIDER_PAYMENT_STARTED: 2,
  PROVIDER_PAYMENT_CONFIRMED: 3,
  PROVIDER_PAYMENT_FAILED: 3,
  CONFIRMED: 4,
  REJECTED: 4,
  CANCELLED: 4,
  EXPIRED: 4,
  REFUND_REQUESTED: 5,
  REFUND_REQUEST_REJECTED: 6,
  REFUNDED: 7,
  EXTERNAL_REFUND_CONFIRMED: 8,
};

/**
 * What actually happened to one purchase, from the rows that already record
 * it.
 *
 * ## Why this exists at all
 *
 * A purchase carries a single `confirmation` — who or what moved it to
 * CONFIRMED — and that one fact was starting to be read as the whole story.
 * It is not. A member of staff agreeing the line item, a provider reporting
 * that money reached it, a customer withdrawing the purchase, and a refund
 * approved a week later are four different events with four different
 * actors, and collapsing them means a partner asking "who let this through"
 * gets an answer about a different question.
 *
 * ## Why it is not a new event table
 *
 * Every fact below is already stored, by the code that performed it, in the
 * row that had to be written anyway: the purchase's own approval and
 * confirmation columns, `PspPaymentAttempt`, `PurchaseIntentRefundRequest`,
 * `PurchaseIntentRefund`. A new append-only event stream would be a second
 * source of truth for things the first one already knows — and a second
 * source of truth about money is the failure mode this system is built to
 * avoid. So this is a read-side projection and writes nothing.
 *
 * ## What it refuses to do
 *
 * It never fills a gap. A purchase confirmed before `confirmationSource`
 * existed has `NOT_RECORDED` against its confirmation, not a guess derived
 * from `paymentRoute` and a null actor — those two together used to mean
 * both "the provider did it" and "this row is older than the column", and a
 * partner cannot be asked to tell them apart.
 */
@Injectable()
export class PurchaseHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async forIntent(purchaseIntentId: string): Promise<PurchaseHistory> {
    const intent = await this.prisma.purchaseIntent.findUnique({
      where: { id: purchaseIntentId },
    });
    if (!intent) throw new NotFoundException('Purchase intent not found');

    const [attempts, refunds, requests] = await Promise.all([
      this.prisma.pspPaymentAttempt.findMany({
        where: { purchaseIntentId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          provider: true,
          status: true,
          createdAt: true,
          confirmedAt: true,
          resolvedAt: true,
          failureReason: true,
        },
      }),
      this.prisma.purchaseIntentRefund.findMany({
        where: { purchaseIntentId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          amount: true,
          reason: true,
          actorId: true,
          createdAt: true,
          externalRefundStatus: true,
          externalRefundConfirmedAt: true,
          externalRefundConfirmedByUserId: true,
        },
      }),
      this.prisma.purchaseIntentRefundRequest.findMany({
        where: { purchaseIntentId },
        orderBy: { requestedAt: 'asc' },
        select: {
          id: true,
          amount: true,
          reason: true,
          status: true,
          requestedByUserId: true,
          requestedAt: true,
          decidedByUserId: true,
          decidedAt: true,
          decisionNote: true,
        },
      }),
    ]);

    // Every user id these rows carry, resolved in one read to the permanent
    // code that person holds at *this* partner. Anybody not on the payroll
    // is `TUTAK` and nothing more — a platform administrator's identity is
    // not a partner's to see.
    const userIds = [
      ...refunds.flatMap((r) => [r.actorId, r.externalRefundConfirmedByUserId]),
      ...requests.flatMap((r) => [r.requestedByUserId, r.decidedByUserId]),
      intent.merchantApprovedByUserId,
      intent.rejectedByUserId,
    ];
    const [codes, onPayroll] = await Promise.all([
      this.codesFor(intent.partnerId, userIds),
      this.onPayroll(intent.partnerId, userIds),
    ]);

    const events: HistoryEvent[] = [];
    const push = (
      type: HistoryEventType,
      at: Date | null,
      actor: HistoryActor,
      detail: Record<string, string | null> = {},
    ) => {
      if (at) events.push({ type, at: at.toISOString(), actor, detail });
    };

    push('CREATED', intent.createdAt, { kind: 'CUSTOMER' }, {
      grossAmount: intent.grossAmount.toFixed(4),
    });

    // Agreeing the line item is not confirming the sale. On a DIRECT
    // purchase the same act does both and this row is stamped on the way
    // past; on a provider purchase it only authorises the bill, and the
    // purchase is completed by the callback further down.
    push(
      'MERCHANT_APPROVED',
      intent.merchantApprovedAt,
      intent.merchantApprovedByApiKeyId
        ? { kind: 'INTEGRATION', apiKeyId: intent.merchantApprovedByApiKeyId }
        : this.staffNow(codes, onPayroll, intent.merchantApprovedByUserId),
      { note: intent.merchantApprovalNote ?? null },
    );

    for (const attempt of attempts) {
      const actor: HistoryActor = { kind: 'PROVIDER', provider: attempt.provider };
      push('PROVIDER_PAYMENT_STARTED', attempt.createdAt, actor, { attemptId: attempt.id });
      push('PROVIDER_PAYMENT_CONFIRMED', attempt.confirmedAt, actor, { attemptId: attempt.id });
      if (attempt.status === PspAttemptStatus.FAILED) {
        push('PROVIDER_PAYMENT_FAILED', attempt.resolvedAt ?? null, actor, {
          attemptId: attempt.id,
          reason: attempt.failureReason ?? null,
        });
      }
    }

    push(
      'CONFIRMED',
      intent.confirmedAt,
      this.confirmationActor(
        intent,
        attempts.find((attempt) => attempt.status === PspAttemptStatus.SUCCEEDED)?.provider ?? null,
      ),
    );
    push('REJECTED', intent.rejectedAt, this.staffNow(codes, onPayroll, intent.rejectedByUserId), {
      reason: intent.rejectionReason ?? null,
    });
    push('CANCELLED', intent.cancelledAt, { kind: 'CUSTOMER' });
    // No `expiredAt` column exists, and inventing one would be a schema
    // change for a fact the deadline already states. The sweep only ever
    // expires a purchase whose `expiresAt` has passed, so on an EXPIRED row
    // that column is the moment it lapsed.
    if (intent.status === PurchaseIntentStatus.EXPIRED) {
      push('EXPIRED', intent.expiresAt, { kind: 'SYSTEM' });
    }

    for (const request of requests) {
      push('REFUND_REQUESTED', request.requestedAt, this.staffNow(codes, onPayroll, request.requestedByUserId), {
        requestId: request.id,
        amount: request.amount ? request.amount.toFixed(4) : null,
        reason: request.reason,
      });
      // Only the refusal is an event of its own. An approved request is
      // followed by the refund itself, which carries the amount that
      // actually moved — two rows saying "approved" and "refunded" for one
      // act would double the history.
      if (request.status === RefundRequestStatus.REJECTED) {
        push(
          'REFUND_REQUEST_REJECTED',
          request.decidedAt,
          this.staffNow(codes, onPayroll, request.decidedByUserId),
          { requestId: request.id, note: request.decisionNote ?? null },
        );
      }
    }

    for (const refund of refunds) {
      push('REFUNDED', refund.createdAt, this.staffNow(codes, onPayroll, refund.actorId), {
        refundId: refund.id,
        amount: refund.amount.toFixed(4),
        reason: refund.reason,
      });
      if (refund.externalRefundStatus === ExternalRefundStatus.CONFIRMED) {
        push(
          'EXTERNAL_REFUND_CONFIRMED',
          refund.externalRefundConfirmedAt,
          this.staffNow(codes, onPayroll, refund.externalRefundConfirmedByUserId),
          { refundId: refund.id },
        );
      }
    }

    events.sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      return ORDER[a.type] - ORDER[b.type];
    });

    return {
      purchaseIntentId: intent.id,
      // The same short form the account activity prints, so a partner
      // quoting a line and a partner quoting a history mean the same thing.
      reference: intent.id.replace(/-/g, '').slice(-8).toUpperCase(),
      status: intent.status,
      events,
    };
  }

  /** The permanent code each of these people holds at this partner, now. */
  private async codesFor(
    partnerId: string,
    userIds: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.partnerEmployee.findMany({
      where: { partnerId, userId: { in: ids } },
      select: { userId: true, code: true },
    });
    return new Map(rows.map((row) => [row.userId, row.code]));
  }

  /** Everyone here who holds a role scoped to this partner, code or not. */
  private async onPayroll(partnerId: string, userIds: (string | null)[]): Promise<Set<string>> {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.userRole.findMany({
      where: { partnerId, userId: { in: ids } },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }

  /**
   * A fact stored with nothing but a user id.
   *
   * Resolved against the payroll as it stands today and labelled
   * `frozen: false`, because that is what it is.
   *
   * The payroll question is asked of `UserRole`, not of the employee-code
   * table. A code is issued the first time somebody needs one — confirming
   * a sale, being posted to a branch — so an owner who has only ever
   * approved refunds has none, and reading the absence of a code as "not
   * one of ours" would report a business's own owner as TuTak. Only
   * somebody with no role at this partner at all is TuTak, and they are
   * named as TuTak and no further: a platform administrator's identity is
   * not a partner's to read.
   */
  private staffNow(
    codes: Map<string, string>,
    onPayroll: Set<string>,
    userId: string | null,
  ): HistoryActor {
    if (!userId) return { kind: 'NOT_RECORDED' };
    const code = codes.get(userId) ?? null;
    if (code !== null || onPayroll.has(userId)) {
      return { kind: 'STAFF', employeeCode: code, frozen: false };
    }
    return { kind: 'TUTAK' };
  }

  /**
   * The confirmation's own actor, from the columns frozen at confirmation.
   *
   * Reads `confirmationSource` first and the identity columns only after,
   * which is the whole point of that column: a null actor with a
   * `TUTAK_PSP` route used to be indistinguishable from a row older than
   * the column, and guessing between them is what produced wrong answers on
   * historical purchases.
   */
  private confirmationActor(
    intent: {
      confirmationSource: PurchaseConfirmationSource | null;
      confirmedByEmployeeCode: string | null;
      confirmedByRole: string | null;
      confirmedByApiKeyId: string | null;
    },
    provider: string | null,
  ): HistoryActor {
    if (
      intent.confirmationSource === PurchaseConfirmationSource.STAFF &&
      intent.confirmedByEmployeeCode
    ) {
      return {
        kind: 'STAFF',
        employeeCode: intent.confirmedByEmployeeCode,
        role: intent.confirmedByRole,
        frozen: true,
      };
    }
    if (
      intent.confirmationSource === PurchaseConfirmationSource.PARTNER_INTEGRATION &&
      intent.confirmedByApiKeyId
    ) {
      return { kind: 'INTEGRATION', apiKeyId: intent.confirmedByApiKeyId };
    }
    if (intent.confirmationSource === PurchaseConfirmationSource.PROVIDER_CALLBACK) {
      // Named from the attempt that reported the money, when there is one.
      // Null rather than a placeholder when there is not: "some provider"
      // is a fact, "provider" as a name is not.
      return { kind: 'PROVIDER', provider };
    }
    return { kind: 'NOT_RECORDED' };
  }
}
