import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, ContributionRuleKind, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionTerms } from './contribution-rule';

type Tx = Prisma.TransactionClient;

/** The value `liveKey` holds while a rule is in force. */
const LIVE = 'live';

export interface OpenRuleParams {
  partnerId: string;
  actorId: string;
  kind: ContributionRuleKind;
  percentBps?: number | null;
  fixedPerUnit?: string | Decimal | null;
  unit?: string | null;
  note?: string;
}

/**
 * A partner's commercial terms, as versions rather than as a mutable rate.
 *
 * Opening a new version closes the previous one in the same transaction, so
 * there is never a moment with two live rules or none. Nothing here edits a
 * rule: the database refuses it (see
 * `partner_contribution_rule_is_immutable`), and this service does not try.
 *
 * ## Why no approval workflow
 *
 * Because nobody has decided what it should be. `PartnerSettlementService`
 * has maker/checker because Arman decided payouts need two people; whether
 * terms do is a separate question he has not answered, and inventing a
 * workflow now would be inventing the commercial process rather than
 * recording it. Every version records who opened it, so adding a checker
 * later is a column and a guard, not a rewrite.
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
      where: { partnerId, liveKey: LIVE },
    });
  }

  /** The same, in the shape the arithmetic wants. */
  static termsOf(rule: {
    kind: ContributionRuleKind;
    percentBps: number | null;
    fixedPerUnit: Decimal | null;
    unit: string | null;
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
      orderBy: { version: 'asc' },
    });
  }

  /**
   * Open the next version of a partner's terms, closing the current one.
   *
   * The version number is allocated by *trying* it, exactly as the purchase
   * confirmation code is: read-then-insert has a window in which two
   * administrators both read version 3 and both write version 4, and only the
   * unique index on `(partnerId, version)` can arbitrate between them.
   */
  async open(params: OpenRuleParams) {
    const shape = normaliseShape(params);

    for (let tries = 0; tries < 5; tries += 1) {
      const previous = await this.liveRule(params.partnerId);
      const version = (previous?.version ?? 0) + 1;
      const now = new Date();

      try {
        return await this.prisma.$transaction(async (tx) => {
          if (previous) {
            // Conditional on it still being live: if another administrator
            // closed it since we read it, this matches nothing and the whole
            // transaction rolls back rather than leaving a gap.
            const closed = await tx.partnerContributionRule.updateMany({
              where: { id: previous.id, liveKey: LIVE },
              data: { effectiveUntil: now, liveKey: null },
            });
            if (closed.count === 0) {
              throw new ConflictException('These terms were changed by someone else — try again');
            }
          }

          const rule = await tx.partnerContributionRule.create({
            data: {
              partnerId: params.partnerId,
              version,
              kind: params.kind,
              ...shape,
              // Strictly after the previous version closed, so the two
              // windows abut rather than overlap by a microsecond.
              effectiveFrom: now,
              liveKey: LIVE,
              createdByUserId: params.actorId,
              note: params.note,
            },
          });

          await this.audit.record(
            {
              actorUserId: params.actorId,
              action: AuditAction.PARTNER_UPDATED,
              entityType: 'PartnerContributionRule',
              entityId: rule.id,
              metadata: {
                event: 'contribution_rule.opened',
                partnerId: params.partnerId,
                version,
                kind: params.kind,
                percentBps: rule.percentBps,
                fixedPerUnit: rule.fixedPerUnit?.toFixed(4) ?? null,
                unit: rule.unit,
                replacedVersion: previous?.version ?? null,
              },
            },
            tx,
          );
          return rule;
        });
      } catch (error) {
        if (!isVersionCollision(error)) throw error;
        this.logger.warn(
          `Version collision opening terms for partner ${params.partnerId}; retrying`,
        );
      }
    }
    throw new ConflictException('These terms are being changed by someone else — try again');
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
function normaliseShape(params: OpenRuleParams) {
  const percent = params.percentBps ?? null;
  const perUnit =
    params.fixedPerUnit === null || params.fixedPerUnit === undefined
      ? null
      : new Decimal(params.fixedPerUnit);
  const unit = params.unit?.trim() || null;

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

function isVersionCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const text = (Array.isArray(target) ? target.join(',') : String(target ?? '')).toLowerCase();
  return text.includes('version') || text.includes('livekey');
}
