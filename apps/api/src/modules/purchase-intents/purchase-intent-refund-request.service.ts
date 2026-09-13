import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  PurchaseIntentStatus,
  RefundRequestStatus,
} from '@prisma/client';
import { MONEY_SCALE, parsePositiveMoney } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PurchaseIntentRefundService } from './purchase-intent-refund.service';

/**
 * Did this come from the one-pending-per-purchase partial unique index?
 *
 * `meta.target` is not one shape: Prisma reports either the indexed field
 * (`['purchaseIntentId']`) or the index's own name
 * (`purchase_intent_refund_requests_one_pending_per_intent_key`), depending
 * on what the driver could resolve. Both are matched; the only other unique
 * index on this table is `refundId`, which neither spelling can match.
 */
function isPendingCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const text = (Array.isArray(target) ? target.join(',') : String(target ?? ''))
    .toLowerCase()
    .replace(/_/g, '');
  return text.includes('purchaseintentid') || text.includes('onepending');
}

/**
 * Maker/checker for refunds — the owner's decision of 2026-09-12.
 *
 * A refund is not an ordinary till action. It moves merchandise value back,
 * restores the customer's spent bonus, and claws back the referral and
 * deferred shares that other people may already have spent. So the person at
 * the counter may *ask* for one, and an owner or manager decides. This is
 * the same maker/checker split `PartnerCollectionService` already uses for
 * bank collections, and it reuses that shape deliberately rather than
 * inventing a second one.
 *
 * What this service is *not*: a second refund engine. Every financial effect
 * still happens exactly once, inside `PurchaseIntentRefundService`, whose
 * serializable transaction, snapshot reversal and idempotency are untouched
 * here. This layer only decides *whether* that engine runs, and records who
 * asked and who agreed.
 */
@Injectable()
export class PurchaseIntentRefundRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: PurchaseIntentRefundService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * A member of staff asks for a refund. Nothing financial happens here.
   *
   * The amount is validated against what is still refundable *now*, purely
   * so a cashier is told "that is more than remains" while the customer is
   * still standing there, rather than having a manager discover it later.
   * It is deliberately **not** frozen: the authoritative check happens again
   * inside the engine at approval, against the live `refundedAmount`.
   */
  async request(params: {
    purchaseIntentId: string;
    amount?: string;
    reason: string;
    requestedByUserId: string;
  }) {
    const intent = await this.prisma.purchaseIntent.findUnique({
      where: { id: params.purchaseIntentId },
    });
    if (!intent) throw new NotFoundException('Purchase intent not found');
    if (intent.status !== PurchaseIntentStatus.CONFIRMED) {
      throw new BadRequestException('Only a confirmed purchase can be refunded');
    }

    const remaining = intent.grossAmount.minus(intent.refundedAmount);
    if (remaining.lessThanOrEqualTo(0)) {
      throw new BadRequestException('This purchase has already been refunded in full');
    }
    if (params.amount) {
      const amount = parsePositiveMoney(params.amount, 'refund amount');
      if (amount.greaterThan(remaining)) {
        throw new BadRequestException(
          `Refund of ${amount.toString()} exceeds the ${remaining.toString()} still refundable on this purchase`,
        );
      }
    }

    try {
      const created = await this.prisma.purchaseIntentRefundRequest.create({
        data: {
          purchaseIntentId: intent.id,
          partnerId: intent.partnerId,
          partnerBranchId: intent.partnerBranchId,
          amount: params.amount ?? null,
          reason: params.reason,
          requestedByUserId: params.requestedByUserId,
        },
      });

      await this.auditService.record({
        actorUserId: params.requestedByUserId,
        action: AuditAction.PURCHASE_INTENT_REFUND_REQUESTED,
        entityType: 'PurchaseIntentRefundRequest',
        entityId: created.id,
        metadata: { purchaseIntentId: intent.id, amount: params.amount ?? 'remaining' },
      });

      return created;
    } catch (error) {
      if (isPendingCollision(error)) {
        throw new BadRequestException(
          'A refund request for this purchase is already waiting for a decision',
        );
      }
      throw error;
    }
  }

  /**
   * An owner or manager agrees, and the refund actually happens.
   *
   * The decision is claimed in the database *before* the engine runs, with a
   * conditional update on `status = PENDING`. That claim — not the engine's
   * idempotency key — is what makes two approvers safe.
   *
   * The first version relied on the key alone (`refund-request:<id>`) and
   * was wrong in a way a test caught before CI did: `PurchaseIntentRefund`
   * is keyed `@@unique([actorId, idempotencyKey])` and the engine's
   * idempotency scope is `purchase-intent-refund:<actorId>`, both *per
   * actor*. Two different approvers tapping Approve at the same moment
   * therefore collided with nothing at all, and the customer was refunded
   * twice — 3000 returned as 6000.
   *
   * So the engine is now always called with the actor recorded on the row,
   * never with "whoever is calling right now". Exactly one approver can win
   * the claim, and every later attempt — a retry, a second approver, a
   * restart after a crash — reuses that same actor and key and is therefore
   * a lookup of the refund that already exists.
   *
   * Ordering and crash recovery: if the engine throws, nothing was posted
   * (its work is one transaction), so the claim is released and the request
   * goes back to PENDING for a human to decide again. If the process dies
   * after the engine committed but before `refundId` was written, the row is
   * APPROVED with a null `refundId`; the next approve() call finishes it,
   * and because the actor comes from the row, the engine answers with the
   * refund it already posted instead of posting a second one.
   */
  async approve(requestId: string, approverUserId: string) {
    const request = await this.findOrThrow(requestId);

    if (request.status === RefundRequestStatus.REJECTED) {
      throw new BadRequestException('This refund request has already been decided');
    }
    if (request.status === RefundRequestStatus.PENDING) {
      this.assertNotSelfApproval(request.requestedByUserId, approverUserId);

      const claimed = await this.prisma.purchaseIntentRefundRequest.updateMany({
        where: { id: request.id, status: RefundRequestStatus.PENDING },
        data: {
          status: RefundRequestStatus.APPROVED,
          decidedByUserId: approverUserId,
          decidedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        // Someone else decided it in the moment between the read and the
        // claim. Whatever they decided stands.
        return this.findOrThrow(requestId);
      }
    }

    const claimedRequest = await this.findOrThrow(requestId);
    if (claimedRequest.refundId) {
      return claimedRequest; // already posted — idempotent
    }

    let refund;
    try {
      refund = await this.refunds.refund({
        purchaseIntentId: claimedRequest.purchaseIntentId,
        amount: claimedRequest.amount ? claimedRequest.amount.toString() : undefined,
        reason: claimedRequest.reason,
        // The decider recorded on the row, never the caller — see the
        // docblock: this is what makes a second approver a lookup.
        actorId: claimedRequest.decidedByUserId ?? approverUserId,
        idempotencyKey: `refund-request:${claimedRequest.id}`,
      });
    } catch (error) {
      // Nothing was posted, so the decision must not stand either — a
      // request stuck APPROVED with no refund behind it is worse than one
      // that visibly needs deciding again.
      await this.prisma.purchaseIntentRefundRequest.updateMany({
        where: { id: claimedRequest.id, status: RefundRequestStatus.APPROVED, refundId: null },
        data: { status: RefundRequestStatus.PENDING, decidedByUserId: null, decidedAt: null },
      });
      throw error;
    }

    return this.prisma.purchaseIntentRefundRequest.update({
      where: { id: claimedRequest.id },
      data: { refundId: refund.refundId },
    });
  }

  /**
   * An owner or manager refunds without asking anyone — and the refund still
   * shows up where every other refund does.
   *
   * The question this answers: is a direct owner refund a legitimate second
   * path, or a hole in dual control? Both, depending on what the control is
   * *for*. The principle the owner chose is that the person at the till may
   * not settle a refund alone. It is not that money can never move without
   * two people: most TuTak partners are one person, and a rule that leaves a
   * solo owner unable to refund a customer standing in front of them would
   * be broken in practice within a week — by handing the owner's login to a
   * cashier, which is worse than the thing the rule was protecting against.
   *
   * So the path stays, with the two properties that make it honest rather
   * than a bypass:
   *
   * 1. **It is not invisible.** It writes the same record an approved
   *    request writes, with the owner as both the person who asked and the
   *    person who agreed. The returns screen, the audit trail and any future
   *    report see one list of refunds, not one list plus a quieter path that
   *    only shows up in the ledger.
   * 2. **It cannot be used to step around a cashier who did ask.** While a
   *    request is waiting on this purchase, the direct route is refused and
   *    the owner is sent to decide that request — which records who asked.
   *    Without this, an owner could answer an awkward request by quietly
   *    refunding the same purchase themselves and leaving the request to
   *    expire, and the record would never say a cashier had raised it.
   */
  async refundDirectly(params: {
    purchaseIntentId: string;
    amount?: string;
    reason: string;
    actorId: string;
    idempotencyKey: string;
  }) {
    const waiting = await this.prisma.purchaseIntentRefundRequest.findFirst({
      where: {
        purchaseIntentId: params.purchaseIntentId,
        status: RefundRequestStatus.PENDING,
      },
    });
    if (waiting) {
      throw new BadRequestException(
        'A refund request is already waiting for a decision on this purchase — approve or refuse that instead',
      );
    }

    const refund = await this.refunds.refund({
      purchaseIntentId: params.purchaseIntentId,
      amount: params.amount,
      reason: params.reason,
      actorId: params.actorId,
      idempotencyKey: params.idempotencyKey,
    });

    // A replayed request returns the refund that already exists, and the
    // record for it already exists too — `refundId` is unique, so this is
    // the lookup rather than a second row.
    const recorded = await this.prisma.purchaseIntentRefundRequest.findUnique({
      where: { refundId: refund.refundId },
    });
    if (recorded) return recorded;

    const intent = await this.prisma.purchaseIntent.findUniqueOrThrow({
      where: { id: params.purchaseIntentId },
    });

    return this.prisma.purchaseIntentRefundRequest.create({
      data: {
        purchaseIntentId: intent.id,
        partnerId: intent.partnerId,
        partnerBranchId: intent.partnerBranchId,
        amount: params.amount ?? null,
        reason: params.reason,
        status: RefundRequestStatus.APPROVED,
        // The same person on both halves, stated rather than hidden: this is
        // one person taking one decision openly, which is exactly what
        // distinguishes it from approving your own request.
        requestedByUserId: params.actorId,
        decidedByUserId: params.actorId,
        decidedAt: new Date(),
        refundId: refund.refundId,
      },
    });
  }

  /** An owner or manager turns it down. Nothing financial happens. */
  async reject(requestId: string, approverUserId: string, note?: string) {
    const request = await this.findOrThrow(requestId);

    if (request.status === RefundRequestStatus.REJECTED) {
      return request; // idempotent, same reasoning as approve()
    }
    if (request.status !== RefundRequestStatus.PENDING) {
      throw new BadRequestException('This refund request has already been decided');
    }
    this.assertNotSelfApproval(request.requestedByUserId, approverUserId);

    const rejected = await this.prisma.purchaseIntentRefundRequest.update({
      where: { id: request.id },
      data: {
        status: RefundRequestStatus.REJECTED,
        decidedByUserId: approverUserId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });

    await this.auditService.record({
      actorUserId: approverUserId,
      action: AuditAction.PURCHASE_INTENT_REFUND_REJECTED,
      entityType: 'PurchaseIntentRefundRequest',
      entityId: request.id,
      metadata: { purchaseIntentId: request.purchaseIntentId, requestedBy: request.requestedByUserId },
    });

    return rejected;
  }

  /**
   * The approver's queue, and the staff member's own record of what they
   * asked for. Branch-scoped by the caller: `branchIds` of `null` means
   * "every branch of this partner" (owner, manager, platform admin), and a
   * list — possibly empty — is exactly the branches this caller works at.
   */
  listForPartner(partnerId: string, status?: RefundRequestStatus, branchIds?: string[] | null) {
    return this.prisma.purchaseIntentRefundRequest.findMany({
      where: {
        partnerId,
        ...(status ? { status } : {}),
        ...(branchIds ? { partnerBranchId: { in: branchIds } } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
  }

  /**
   * The wire shape. Prisma hands back `Decimal` and `Date`; both serialize
   * to something a client can read, but only by accident of whatever
   * `JSON.stringify` decides today. Money is a string here for the same
   * reason it is everywhere else in this codebase — a JSON number cannot
   * hold 18,4 without lying — and timestamps are ISO strings.
   */
  toDto(request: {
    id: string;
    purchaseIntentId: string;
    partnerId: string;
    partnerBranchId: string | null;
    amount: Prisma.Decimal | null;
    reason: string;
    status: RefundRequestStatus;
    requestedByUserId: string;
    requestedAt: Date;
    decidedByUserId: string | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    refundId: string | null;
  }) {
    return {
      id: request.id,
      purchaseIntentId: request.purchaseIntentId,
      partnerId: request.partnerId,
      partnerBranchId: request.partnerBranchId,
      amount: request.amount ? request.amount.toFixed(MONEY_SCALE) : null,
      reason: request.reason,
      status: request.status,
      requestedByUserId: request.requestedByUserId,
      requestedAt: request.requestedAt.toISOString(),
      decidedByUserId: request.decidedByUserId,
      decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
      decisionNote: request.decisionNote,
      refundId: request.refundId,
    };
  }

  findOrThrow(requestId: string) {
    return this.prisma.purchaseIntentRefundRequest
      .findUnique({ where: { id: requestId } })
      .then((request) => {
        if (!request) throw new NotFoundException('Refund request not found');
        return request;
      });
  }

  private assertNotSelfApproval(requestedByUserId: string, approverUserId: string) {
    if (requestedByUserId === approverUserId) {
      throw new ForbiddenException(
        'A refund must be approved by someone other than the person who requested it',
      );
    }
  }
}
