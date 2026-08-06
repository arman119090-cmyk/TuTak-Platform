'use client';

import { useQuery } from '@tanstack/react-query';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { StatCard } from '@/components/StatCard';

export default function OverviewPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const { data: partner } = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => partnerApi.get(partnerId!),
    enabled: !!partnerId,
  });

  const { data: analytics } = useQuery({
    queryKey: ['partner-analytics', partnerId],
    queryFn: () => partnerApi.analytics(partnerId!),
    enabled: !!partnerId,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">{partner?.displayName ?? 'Overview'}</h1>
      <p className="mt-1 text-sm text-neutral-500">Your business at a glance.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Transactions" value={String(analytics?.totalTransactions ?? '—')} />
        <StatCard label="Revenue (AMD)" value={analytics?.totalRevenue ?? '—'} accent="#0B5D3B" />
        <StatCard label="Bonus issued" value={analytics?.totalBonusIssued ?? '—'} accent="#F5A623" />
        <StatCard label="Bonus redeemed" value={analytics?.totalBonusRedeemed ?? '—'} accent="#2E7CF6" />
        <StatCard label="Unique customers" value={String(analytics?.uniqueCustomers ?? '—')} />
        <StatCard
          label="Bonus accrual rate"
          value={partner ? `${(partner.bonusAccrualRateBps / 100).toFixed(2)}%` : '—'}
        />
      </div>
    </div>
  );
}
