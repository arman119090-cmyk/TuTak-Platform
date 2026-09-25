import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CommissionRule } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Partner Commerce (docs/PARTNER_COMMERCE_2026-09-25.md), spec §19: a
 * configurable commission rate per partner (and, optionally, per category)
 * rather than hardcoded percentages per partner name.
 *
 * Resolution precedence, most specific first:
 *   1. an active rule for this partner + this exact category
 *   2. an active rule for this partner with no category (`category: null`)
 *   3. `purchasePolicy.partnerOrderDefaultCommissionBps` — the platform
 *      default, so an unconfigured partner still works.
 *
 * Rules are never deleted, only deactivated (`isActive: false`) — an order
 * already created keeps its own frozen `commissionRateBps`/`commissionRuleId`
 * snapshot (see `PartnerOrder`), so history never depends on a rule row
 * still existing or being active.
 */
@Injectable()
export class CommissionRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Always returns a usable rate — never throws for "no rule configured". */
  async resolve(partnerId: string, category?: string | null): Promise<{ rule: CommissionRule | null; rateBps: number }> {
    if (category) {
      const specific = await this.prisma.commissionRule.findFirst({
        where: { partnerId, category, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      if (specific) return { rule: specific, rateBps: specific.rateBps };
    }

    const partnerWide = await this.prisma.commissionRule.findFirst({
      where: { partnerId, category: null, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (partnerWide) return { rule: partnerWide, rateBps: partnerWide.rateBps };

    return { rule: null, rateBps: this.config.get('partnerOrderPolicy.defaultCommissionBps', { infer: true }) };
  }

  list(partnerId?: string) {
    return this.prisma.commissionRule.findMany({
      where: partnerId ? { partnerId } : undefined,
      orderBy: [{ partnerId: 'asc' }, { category: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(params: {
    partnerId: string | null;
    category?: string | null;
    name: string;
    rateBps: number;
    actorUserId: string;
  }) {
    if (!Number.isInteger(params.rateBps) || params.rateBps < 0 || params.rateBps > 10_000) {
      throw new BadRequestException('rateBps must be an integer between 0 and 10000');
    }
    const rule = await this.prisma.commissionRule.create({
      data: {
        partnerId: params.partnerId,
        category: params.category ?? null,
        name: params.name,
        rateBps: params.rateBps,
        createdByUserId: params.actorUserId,
      },
    });

    await this.auditService.record({
      actorUserId: params.actorUserId,
      action: AuditAction.COMMISSION_RULE_CREATED,
      entityType: 'CommissionRule',
      entityId: rule.id,
      metadata: { partnerId: params.partnerId, category: params.category ?? null, rateBps: params.rateBps },
    });

    return rule;
  }

  async deactivate(id: string, actorUserId: string) {
    const existing = await this.prisma.commissionRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Commission rule not found');

    const rule = await this.prisma.commissionRule.update({
      where: { id },
      data: { isActive: false },
    });

    await this.auditService.record({
      actorUserId,
      action: AuditAction.COMMISSION_RULE_UPDATED,
      entityType: 'CommissionRule',
      entityId: rule.id,
      metadata: { event: 'deactivated' },
    });

    return rule;
  }
}
