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
import { parsePositiveMoney } from '../../common/utils/money';
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
