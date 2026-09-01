import { Injectable } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Partner totals for a period.
   *
   * Aggregated by the database rather than in memory. Loading every matching
   * transaction and reducing over it was an out-of-memory denial of service
   * once a partner had real history, and `Number(t.amount)` summed money in
   * IEEE 754 after the whole codebase was built on Decimal, so the revenue a
   * partner saw drifted from the revenue they earned
   * (docs/AUDIT_2026-08-B.md §H9).
   */
  /**
   * `branchIds` is `branchFilterFor`'s answer for the caller: `null` for an
   * owner, admin or all-branch manager, who keeps seeing the partner's whole
   * network; otherwise the branches they are actually assigned to.
   *
   * Aggregates need this more than list endpoints do, not less. A total is
   * not a redacted list — a branch-scoped manager reading network-wide
   * revenue, bonus issuance and unique-customer counts learns their
   * colleagues' figures just as surely as by reading the rows, and there is
   * nothing in the response to redact after the fact. Hence the filter is in
   * the `where` both the aggregate and the groupBy share.
   */
  async partnerAnalytics(partnerId: string, from?: Date, to?: Date, branchIds: string[] | null = null) {
    const where = {
      partnerId,
      status: TransactionStatus.COMPLETED,
      ...(branchIds === null ? {} : { partnerBranchId: { in: branchIds } }),
      ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    };

    const [totals, distinctCustomers] = await Promise.all([
      this.prisma.transaction.aggregate({
        where,
        _count: true,
        _sum: { amount: true, bonusEarnedAmount: true, bonusAppliedAmount: true },
      }),
      // groupBy rather than a set built from every row: only the distinct
      // user ids cross the wire, not the transactions themselves.
      this.prisma.transaction.groupBy({ by: ['userId'], where }),
    ]);

    return {
      partnerId,
      periodFrom: from?.toISOString() ?? null,
      periodTo: to?.toISOString() ?? null,
      totalTransactions: totals._count,
      totalRevenue: (totals._sum.amount ?? new Decimal(0)).toFixed(4),
      totalBonusIssued: (totals._sum.bonusEarnedAmount ?? new Decimal(0)).toFixed(4),
      totalBonusRedeemed: (totals._sum.bonusAppliedAmount ?? new Decimal(0)).toFixed(4),
      uniqueCustomers: distinctCustomers.length,
    };
  }

  async platformOverview() {
    const [byType, byStatus, walletTotals] = await Promise.all([
      this.prisma.transaction.groupBy({ by: ['type'], _count: true, _sum: { amount: true } }),
      this.prisma.transaction.groupBy({ by: ['status'], _count: true }),
      this.prisma.wallet.aggregate({
        _sum: { lifetimeEarned: true, lifetimeSpent: true, availableBonus: true },
      }),
    ]);

    return {
      transactionsByType: byType.map((t) => ({
        type: t.type,
        count: t._count,
        totalAmount: t._sum.amount?.toString() ?? '0',
      })),
      transactionsByStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      bonusTotals: {
        lifetimeEarned: walletTotals._sum.lifetimeEarned?.toString() ?? '0',
        lifetimeSpent: walletTotals._sum.lifetimeSpent?.toString() ?? '0',
        currentlyAvailable: walletTotals._sum.availableBonus?.toString() ?? '0',
      },
    };
  }
}
