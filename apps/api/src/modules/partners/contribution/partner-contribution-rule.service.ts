import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ContributionRuleKind,
  ContributionRuleStatus,
  Prisma,
  UnitOfMeasure,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionTerms } from './contribution-rule';

type Tx = Prisma.TransactionClient;

/** The value `liveKey` holds while a rule is the one in force. */
const LIVE = 'live';

export interface ProposeRuleParams {
  partnerId: string;
  /** The maker. Never also the checker — the database enforces that too. */
  actorId: string;
  kind: ContributionRuleKind;
  percentBps?: number | null;
  fixedPerUnit?: string | Decimal | null;
  unit?: UnitOfMeasure | null;
  note?: string;
}

/**
 * A partner's commercial terms: proposed by one person, approved by another,
 * versioned, and never edited.
 *
 * ## Why this is not one call any more
 *
 * It used to be. `open()` wrote a live rule and, on a unique violation,
 * retried — and that retry is the bug Arman's review of 15.09.2026 names.
 * Two administrators changing HAZE's margin at the same time did not
 * conflict: one won version 4, the loser's retry read the new state and
 * became version 5. Both looked like deliberate, audited changes. Nobody had
 * agreed to the combination, and the partner ended up on whichever margin
 * happened to be written second.
 *
 * The fix is that a proposal is inert. It carries no version number, no
 * window and no `liveKey`, so writing one can never conflict with anything
 * and never needs a retry. Approval is the only step that allocates a number
 * and moves money's price, and it is a single conditional transaction: close
 * the current ACTIVE row, activate this one. Two competing approvals hit that
 * condition, one wins, the other is told what happened rather than quietly
 * applied on top.
 */
@Injectable()
export class PartnerContributionRuleService {
  private readonly logger = new Logger(PartnerContributionRuleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The terms in force for this partner, or null if they have never had any. */
  async liveRule(partnerId: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    return db.partnerContributionRule.findFirst({
      where: { partnerId, liveKey: LIVE, status: ContributionRuleStatus.ACTIVE },
    });
  }

  /** The same, in the shape the arithmetic wants. */
  static termsOf(rule: {
    kind: ContributionRuleKind;
    percentBps: number | null;
    fixedPerUnit: Decimal | null;
    unit: UnitOfMeasure | null;
  }): ContributionTerms {
    return {
      kind: rule.kind,
      percentBps: rule.percentBps,
      fixedPerUnit: rule.fixedPerUnit,
      unit: rule.unit,
    };
  }

  async history(partnerId: string) {
    return this.prisma.partnerContributionRule.findMany({
      where: { partnerId },
      orderBy: [{ version: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async pendingProposals(partnerId: string) {
    return this.prisma.partnerContributionRule.findMany({
      where: { partnerId, status: ContributionRuleStatus.PROPOSED },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Write down terms somebody is asking for. Changes nothing.
   *
   * No version number and no retry loop, because there is nothing to collide
   * with: a partner may have several open proposals, and until one is
   * approved none of them prices anything. That is the whole point — a
   * concurrent write here is two people making two suggestions, which is a
   * normal thing for two people to do.
   */
  async propose(params: ProposeRuleParams) {
    const shape = normaliseShape(params);

    const rule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.partnerContributionRule.create({
        data: {
          partnerId: params.partnerId,
          status: ContributionRuleStatus.PROPOSED,
          kind: params.kind,
          ...shape,
          proposedByUserId: params.actorId,
          createdByUserId: params.actorId,
          note: params.note,
        },
      });

      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerContributionRule',
          entityId: created.id,
          metadata: {
            event: 'contribution_rule.proposed',
            partnerId: params.partnerId,
            kind: params.kind,
            percentBps: created.percentBps,
            fixedPerUnit: created.fixedPerUnit?.toFixed(4) ?? null,
            unit: created.unit,
          },
        },
        tx,
      );
      return created;
    });

    this.logger.log(
      `Contribution rule ${rule.id} proposed for partner ${params.partnerId} by ${params.actorId}`,
    );
    return rule;
  }

  /**
   * A second person agrees. This is the step that changes what a purchase
   * costs.
   *
   * One transaction, and the version number is allocated inside it from what
   * is actually in force at that moment. Two administrators approving two
   * different proposals at the same instant both try to close the same ACTIVE
   * row; the conditional `updateMany` means exactly one sees a row to close,
   * and the other's whole transaction rolls back with nothing written. The
   * partial unique index on `(partnerId, liveKey)` is the second lock on the
   * same door, for the case where there was no ACTIVE row to close.
   *
   * No retry. A retry here is precisely what produced two silent sequential
   * changes before; the loser is told to look at what just happened.
   */
  async approve(ruleId: string, params: { actorId: string; note?: string }) {
    const proposal = await this.prisma.partnerContributionRule.findUnique({
      where: { id: ruleId },
    });
    if (!proposal) throw new NotFoundException('Proposed terms not found');
    if (proposal.status !== ContributionRuleStatus.PROPOSED) {
      throw new ConflictException(
        `These terms are ${proposal.status}; only a proposal can be approved`,
      );
    }
    if (proposal.proposedByUserId === params.actorId) {
      throw new ForbiddenException('You proposed these terms; a second person has to approve them');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const current = await tx.partnerContributionRule.findFirst({
          where: { partnerId: proposal.partnerId, liveKey: LIVE },
        });

        if (current) {
          const closed = await tx.partnerContributionRule.updateMany({
            where: { id: current.id, liveKey: LIVE },
            data: {
              status: ContributionRuleStatus.SUPERSEDED,
              effectiveUntil: now,
              liveKey: null,
            },
          });
          if (closed.count === 0) {
            // Somebody else's approval got here first. Rolling back is the
            // point: their version is in force, and this proposal is still a
            // proposal, to be approved or dropped once a human has looked.
            throw new ConflictException(
              'Another change to these terms was approved a moment ago — review it before approving this one',
            );
          }
        }

        const version = (current?.version ?? 0) + 1;
        await tx.partnerContributionRule.update({
          where: { id: proposal.id },
          data: {
            status: ContributionRuleStatus.ACTIVE,
            version,
            effectiveFrom: now,
            liveKey: LIVE,
            approvedByUserId: params.actorId,
            approvedAt: now,
            decisionNote: params.note,
          },
        });

        await this.audit.record(
          {
            actorUserId: params.actorId,
            action: AuditAction.PARTNER_UPDATED,
            entityType: 'PartnerContributionRule',
            entityId: proposal.id,
            metadata: {
              event: 'contribution_rule.approved',
              partnerId: proposal.partnerId,
              version,
              kind: proposal.kind,
              proposedBy: proposal.proposedByUserId,
              replacedVersion: current?.version ?? null,
            },
          },
          tx,
        );
        return tx.partnerContributionRule.findUniqueOrThrow({ where: { id: proposal.id } });
      });
    } catch (error) {
      if (isLiveRuleCollision(error)) {
        throw new ConflictException(
          'Another change to these terms was approved a moment ago — review it before approving this one',
        );
      }
      throw error;
    }
  }

  /** A second person says no. Kept rather than deleted: who said no is audit. */
  async reject(ruleId: string, params: { actorId: string; reason: string }) {
    const reason = params.reason.trim();
    if (!reason) throw new BadRequestException('Say why these terms were turned down');

    const proposal = await this.prisma.partnerContributionRule.findUnique({
      where: { id: ruleId },
    });
    if (!proposal) throw new NotFoundException('Proposed terms not found');
    if (proposal.status !== ContributionRuleStatus.PROPOSED) {
      throw new ConflictException(
        `These terms are ${proposal.status}; only a proposal can be rejected`,
      );
    }
    if (proposal.proposedByUserId === params.actorId) {
      throw new ForbiddenException('You proposed these terms; somebody else has to turn them down');
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerContributionRule.updateMany({
        where: { id: ruleId, status: ContributionRuleStatus.PROPOSED },
        data: {
          status: ContributionRuleStatus.REJECTED,
          rejectedByUserId: params.actorId,
          rejectedAt: new Date(),
          decisionNote: reason,
        },
      });
      if (claimed.count === 0) throw new ConflictException('These terms were already decided');

      await this.audit.record(
        {
          actorUserId: params.actorId,
          action: AuditAction.PARTNER_UPDATED,
          entityType: 'PartnerContributionRule',
          entityId: ruleId,
          metadata: {
            event: 'contribution_rule.rejected',
            partnerId: proposal.partnerId,
            reason,
          },
        },
        tx,
      );
      return tx.partnerContributionRule.findUniqueOrThrow({ where: { id: ruleId } });
    });
  }
}

/**
 * Only the fields this kind may carry, and nulls for the rest.
 *
 * The database checks the same thing (`shape_matches_kind`), and that is the
 * boundary that matters; this is here so a caller gets a sentence instead of
 * a constraint name, and so a stray `percentBps` on a per-unit rule is
 * dropped rather than becoming a violation.
 */
function normaliseShape(params: ProposeRuleParams) {
  const percent = params.percentBps ?? null;
  const perUnit =
    params.fixedPerUnit === null || params.fixedPerUnit === undefined
      ? null
      : new Decimal(params.fixedPerUnit);
  const unit = params.unit ?? null;

  switch (params.kind) {
    case ContributionRuleKind.PERCENT_BPS:
      if (percent === null) throw new BadRequestException('Percentage terms need a rate');
      return { percentBps: percent, fixedPerUnit: null, unit: null };
    case ContributionRuleKind.FIXED_PER_UNIT:
      if (perUnit === null || unit === null) {
        throw new BadRequestException('Per-unit terms need an amount and a unit');
      }
      return { percentBps: null, fixedPerUnit: perUnit, unit };
    case ContributionRuleKind.HYBRID:
      if (percent === null || perUnit === null || unit === null) {
        throw new BadRequestException('Hybrid terms need a rate, an amount and a unit');
      }
      return { percentBps: percent, fixedPerUnit: perUnit, unit };
  }
}

/** The unique index on `(partnerId, liveKey)` refusing a second live rule. */
function isLiveRuleCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const text = (Array.isArray(target) ? target.join(',') : String(target ?? '')).toLowerCase();
  return text.includes('livekey');
}
