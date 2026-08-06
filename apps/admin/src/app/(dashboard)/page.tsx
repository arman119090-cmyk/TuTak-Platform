'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/adminApi';
import { analyticsApi } from '@/lib/api/analyticsApi';
import { StatCard } from '@/components/StatCard';

export default function OverviewPage() {
  const { data: overview } = useQuery({ queryKey: ['admin-overview'], queryFn: adminApi.overview });
  const { data: platform } = useQuery({ queryKey: ['platform-analytics'], queryFn: analyticsApi.platform });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-neutral-500">Platform-wide snapshot.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Users" value={String(overview?.userCount ?? '—')} />
        <StatCard label="Partners" value={String(overview?.partnerCount ?? '—')} />
        <StatCard label="Transactions" value={String(overview?.transactionCount ?? '—')} />
        <StatCard
          label="Available bonus (all wallets)"
          value={overview?.totalAvailableBonus ?? '—'}
          accent="#1DB954"
        />
        <StatCard label="Pending bonus" value={overview?.totalPendingBonus ?? '—'} accent="#F5A623" />
        <StatCard label="Reserved bonus" value={overview?.totalReservedBonus ?? '—'} accent="#2E7CF6" />
        <StatCard label="Lifetime earned" value={platform?.bonusTotals.lifetimeEarned ?? '—'} />
        <StatCard label="Lifetime spent" value={platform?.bonusTotals.lifetimeSpent ?? '—'} />
      </div>

      <div className="mt-8 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Transactions by type</h2>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="pb-2">Type</th>
              <th className="pb-2">Count</th>
              <th className="pb-2">Total amount</th>
            </tr>
          </thead>
          <tbody>
            {platform?.transactionsByType.map((row) => (
              <tr key={row.type} className="border-t border-neutral-100">
                <td className="py-2">{row.type}</td>
                <td className="py-2">{row.count}</td>
                <td className="py-2">{row.totalAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
