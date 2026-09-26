import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CommissionRule, PrepaymentMode, PrepaymentRule, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { isCommissionRateBps } from '../../common/validators/is-commission-rate-bps.validator';
import { parsePositiveMoney, roundCharge } from '../../common/utils/money';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Scope = { serviceType?: string | null; category?: string | null };

/**
 * The one deterministic scope resolution both rule kinds share (Q5 = A):
 *
 *   1. an active rule for exactly this serviceType + category
 *   2. an active rule for this serviceType, any category (category null)
 *   3. an active rule for this category, any serviceType (serviceType null)
 *   4. (prepayment only) an active partner-wide rule (both null)
 *
 * At most one active rule per scope is a partial unique index, so each step
 * finds zero or one row — two rules can never compete for the same order.
 */
function candidateScopes(scope: Scope, includePartnerWide: boolean) {
  const serviceType = scope.serviceType?.trim() || null;
  const category = scope.category?.trim() || null;
  const scopes: { serviceType: string | null; category: string | null }[] = [];
  if (serviceType && category) scopes.push({ serviceType, category });
  if (serviceType) scopes.push({ serviceType, category: null });
  if (category) scopes.push({ serviceType: null, category });
  if (includePartnerWide) scopes.push({ serviceType: null, category: null });
  return scopes;
}

function uniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Commission overrides and prepayment rules — Partner Commerce (Q5, spec
 * §12, §30, §67). Configuration, never code: nothing here knows any
 * partner's name. Only a platform admin manages either (the controller
 * enforces it — a partner can never change its own commission, spec §62).
 * Rules are never deleted, only deactivated; an order keeps its own frozen
 * snapshot of the rate and prepayment it was created with.
 */
@Injectable()
export class CommerceRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The rate for one order: the most specific active override, else the
   * partner's own `bonusAccrualRateBps` — never a second, platform-level
   * default (v1 error E4).
   */
  async resolveCommission(
    partner: { id: string; bonusAccrualRateBps: number },
    scope: Scope,
  ): Promise<{ rule: CommissionRule | null; rateBps: number }> {
    for (const candidate of candidateScopes(scope, false)) {
      const rule = await this.prisma.commissionRule.findFirst({
        where: { partnerId: partner.id, isActive: true, ...candidate },
      });
      if (rule) return { rule, rateBps: rule.rateBps };
    }
    return { rule: null, rateBps: partner.bonusAccrualRateBps };
  }

  /** Spec §30: 0 unless a rule says otherwise; never more than the total. */
  async resolvePrepayment(
    partnerId: string,
    scope: Scope,
    totalAmount: Decimal,
  ): Promise<{ rule: PrepaymentRule | null; amount: Decimal }> {
    for (const candidate of candidateScopes(scope, true)) {
      const rule = await this.prisma.prepaymentRule.findFirst({
        where: { partnerId, isActive: true, ...candidate },
      });
      if (!rule) continue;
      const raw =
        rule.mode === PrepaymentMode.PERCENT
          ? totalAmount.times(rule.percentBps ?? 0).dividedBy(10_000)
          : (rule.fixedAmount ?? new Decimal(0));
      return { rule, amount: Decimal.min(roundCharge(raw), totalAmount) };
    }
    return { rule: null, amount: new Decimal(0) };
  }

  listCommissionRules(partnerId?: string) {
    return this.prisma.commissionRule.findMany({
      where: partnerId ? { partnerId } : undefined,
      orderBy: [{ partnerId: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createCommissionRule(input: {
    partnerId: string;
    serviceType?: string | null;
    category?: string | null;
    name: string;
    rateBps: number;
    actorUserId: string;
  }) {
    const serviceType = input.serviceType?.trim() || null;
    const category = input.category?.trim() || null;
    if (!serviceType && !category) {
      throw new BadRequestException(
        "A commission override needs a serviceType and/or category — the partner's base rate is its bonusAccrualRateBps",
      );
    }
    // Q5: the same 0.5–20% rate card as the partner's base rate; a rate
    // outside it is a business decision to raise, not to encode quietly.
    if (!isCommissionRateBps(input.rateBps)) {
      throw new BadRequestException('rateBps must be a multiple of 50 between 50 and 2000 (0.5%–20%)');
    }
    await this.assertPartnerExists(input.partnerId);
    try {
      const rule = await this.prisma.commissionRule.create({
        data: {
          partnerId: input.partnerId,
          serviceType,
          category,
          name: input.name,
          rateBps: input.rateBps,
          createdByUserId: input.actorUserId,
        },
      });
      await this.auditService.record({
        actorUserId: input.actorUserId,
        action: AuditAction.COMMISSION_RULE_CREATED,
        entityType: 'CommissionRule',
        entityId: rule.id,
        metadata: { partnerId: input.partnerId, serviceType, category, rateBps: input.rateBps },
      });
      return rule;
    } catch (err) {
      if (uniqueViolation(err)) {
        throw new ConflictException('An active commission rule already exists for this scope — deactivate it first');
      }
      throw err;
    }
  }

  async deactivateCommissionRule(id: string, actorUserId: string) {
    const rule = await this.prisma.commissionRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Commission rule not found');
    const updated = await this.prisma.commissionRule.update({ where: { id }, data: { isActive: false } });
    await this.auditService.record({
      actorUserId,
      action: AuditAction.COMMISSION_RULE_UPDATED,
      entityType: 'CommissionRule',
      entityId: id,
      metadata: { isActive: false },
    });
    return updated;
  }

  listPrepaymentRules(partnerId?: string) {
    return this.prisma.prepaymentRule.findMany({
      where: partnerId ? { partnerId } : undefined,
      orderBy: [{ partnerId: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createPrepaymentRule(input: {
    partnerId: string;
    serviceType?: string | null;
    category?: string | null;
    mode: PrepaymentMode;
    percentBps?: number | null;
    fixedAmount?: string | null;
    actorUserId: string;
  }) {
    const serviceType = input.serviceType?.trim() || null;
    const category = input.category?.trim() || null;
    let percentBps: number | null = null;
    let fixedAmount: Decimal | null = null;
    if (input.mode === PrepaymentMode.PERCENT) {
      if (!Number.isInteger(input.percentBps) || input.percentBps! < 1 || input.percentBps! > 10_000) {
        throw new BadRequestException('percentBps must be an integer between 1 and 10000');
      }
      percentBps = input.percentBps!;
    } else {
      if (!input.fixedAmount) throw new BadRequestException('fixedAmount is required for a FIXED prepayment');
      fixedAmount = parsePositiveMoney(input.fixedAmount, 'fixedAmount');
    }
    await this.assertPartnerExists(input.partnerId);
    try {
      const rule = await this.prisma.prepaymentRule.create({
        data: {
          partnerId: input.partnerId,
          serviceType,
          category,
          mode: input.mode,
          percentBps,
          fixedAmount,
          createdByUserId: input.actorUserId,
        },
      });
      await this.auditService.record({
        actorUserId: input.actorUserId,
        action: AuditAction.PREPAYMENT_RULE_CREATED,
        entityType: 'PrepaymentRule',
        entityId: rule.id,
        metadata: { partnerId: input.partnerId, serviceType, category, mode: input.mode, percentBps, fixedAmount: fixedAmount?.toString() ?? null },
      });
      return rule;
    } catch (err) {
      if (uniqueViolation(err)) {
        throw new ConflictException('An active prepayment rule already exists for this scope — deactivate it first');
      }
      throw err;
    }
  }

  async deactivatePrepaymentRule(id: string, actorUserId: string) {
    const rule = await this.prisma.prepaymentRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Prepayment rule not found');
    const updated = await this.prisma.prepaymentRule.update({ where: { id }, data: { isActive: false } });
    await this.auditService.record({
      actorUserId,
      action: AuditAction.PREPAYMENT_RULE_UPDATED,
      entityType: 'PrepaymentRule',
      entityId: id,
      metadata: { isActive: false },
    });
    return updated;
  }

  private async assertPartnerExists(partnerId: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!partner) throw new NotFoundException('Partner not found');
  }
}
