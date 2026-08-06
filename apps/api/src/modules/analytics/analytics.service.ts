import { Injectable } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async partnerAnalytics(partnerId: string, from?: string, to?: string) {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        partnerId,
        status: TransactionStatus.COMPLETED,
        createdAt:
          from || to
            ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined }
            : undefined,
      },
    });

    const totalRevenue = transactions.reduce((acc, t) => acc + Number(t.amount), 0);
    const totalBonusIssued = transactions.reduce((acc, t) => acc + Number(t.bonusEarnedAmount), 0);
    const totalBonusRedeemed = transactions.reduce((acc, t) => acc + Number(t.bonusAppliedAmount), 0);
    const uniqueCustomers = new Set(transactions.map((t) => t.userId)).size;

    return {
      partnerId,
      periodFrom: from ?? null,
      periodTo: to ?? null,
      totalTransactions: transactions.length,
      totalRevenue: totalRevenue.toFixed(2),
      totalBonusIssued: totalBonusIssued.toFixed(4),
      totalBonusRedeemed: totalBonusRedeemed.toFixed(4),
      uniqueCustomers,
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
