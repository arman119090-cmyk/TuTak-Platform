import { Injectable } from '@nestjs/common';
import { PurchaseIntentStatus, TransactionStatus } from '@prisma/client';
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

    const [totals, distinctCustomers, refunded] = await Promise.all([
      this.prisma.transaction.aggregate({
        where,
        _count: true,
        _sum: { amount: true, bonusEarnedAmount: true, bonusAppliedAmount: true },
      }),
      // groupBy rather than a set built from every row: only the distinct
      // user ids cross the wire, not the transactions themselves.
      this.prisma.transaction.groupBy({ by: ['userId'], where }),
      /*
       * What went back over the counter.
       *
       * `totalRevenue` sums `Transaction.amount`, and a refund neither
       * changes that column nor moves the transaction out of COMPLETED — a
       * refund is a new record pointing back at the original, because
       * postings are immutable. So a dinner that was refunded in full still
       * counted as revenue in the partner's own dashboard, and the response
       * said nothing at all about refunds: there was no figure a reader
       * could subtract, and no hint that one was missing.
       *
       * Read off `PurchaseIntent.refundedAmount` rather than by summing
       * `PurchaseIntentRefund` rows: the intent's column is the one a
       * conditional UPDATE keeps within `grossAmount`, so it cannot drift
       * above what was actually sold, and it is the same number the refund
       * engine itself decides against.
       *
       * Scoped by the same branch filter as the totals above. A
       * branch-scoped manager seeing network-wide refunds would learn their
       * colleagues' figures just as surely as by reading the rows.
       */
      this.prisma.purchaseIntent.aggregate({
        where: {
          partnerId,
          status: PurchaseIntentStatus.CONFIRMED,
          ...(branchIds === null ? {} : { partnerBranchId: { in: branchIds } }),
          ...(from || to ? { confirmedAt: { gte: from, lte: to } } : {}),
        },
        _sum: { refundedAmount: true },
      }),
    ]);

    const totalRevenue = totals._sum.amount ?? new Decimal(0);
    const totalRefunded = refunded._sum.refundedAmount ?? new Decimal(0);

    return {
      partnerId,
      periodFrom: from?.toISOString() ?? null,
      periodTo: to?.toISOString() ?? null,
      totalTransactions: totals._count,
      /** Gross — everything that was rung up, refunds included. Unchanged. */
      totalRevenue: totalRevenue.toFixed(4),
      /** Merchandise value handed back against those purchases. */
      totalRefunded: totalRefunded.toFixed(4),
      /**
       * What the partner actually sold. Added beside `totalRevenue` rather
       * than replacing it: gross and net are both real figures a business
       * needs, and quietly redefining a field every existing dashboard
       * already reads would change numbers nobody asked to change.
       */
      netRevenue: totalRevenue.minus(totalRefunded).toFixed(4),
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
