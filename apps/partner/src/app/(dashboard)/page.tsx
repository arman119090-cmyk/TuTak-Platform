'use client';

import { useQuery } from '@tanstack/react-query';
import { BonusCompositionBar, PageHeader, StatTile, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');
const amd = (v: string | number | undefined) => `${num(v)} ֏`;

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

  const issued = Number(analytics?.totalBonusIssued ?? 0);
  const redeemed = Number(analytics?.totalBonusRedeemed ?? 0);

  return (
    <>
      <PageHeader
        title={partner?.displayName ?? 'Overview'}
        description="How your business is performing on TuTak."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Revenue" value={amd(analytics?.totalRevenue)} tone="brand" />
        <StatTile label="Transactions" value={num(analytics?.totalTransactions)} />
        <StatTile label="Unique customers" value={num(analytics?.uniqueCustomers)} />
        <StatTile
          label="Bonus accrual rate"
          value={partner ? `${(partner.bonusAccrualRateBps / 100).toFixed(2)}%` : '—'}
          hint="Earned by customers on every payment"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Issued vs redeemed is the number a partner actually cares about:
            what the loyalty programme costs versus what it brings back. */}
        <Surface>
          <div className="text-[15px] font-semibold text-ink">Bonus flow</div>
          <p className="mt-1 mb-5 text-[13px] text-muted">
            Points you have given customers, and points they have spent with you.
          </p>

          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] text-muted">Issued to customers</span>
              <span className="tabular text-[19px] font-semibold text-available-text">
                {num(issued)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] text-muted">Redeemed with you</span>
              <span className="tabular text-[19px] font-semibold text-reserved-text">
                {num(redeemed)}
              </span>
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <BonusCompositionBar
              available={issued}
              pending={0}
              reserved={redeemed}
              labels={{ available: 'Issued', pending: '—', reserved: 'Redeemed' }}
              showLegend={false}
            />
            <p className="mt-3 text-[12px] text-faint">
              Redeemed points return customers to your business — a higher share is a healthier
              programme.
            </p>
          </div>
        </Surface>

        <Surface>
          <div className="text-[15px] font-semibold text-ink">Your business</div>
          <dl className="mt-5 space-y-4">
            <Row label="Legal name" value={partner?.legalName ?? '—'} />
            <Row label="Category" value={partner?.category ?? '—'} />
            <Row label="Tax ID" value={partner?.taxId ?? '—'} mono />
            <Row
              label="Status"
              value={partner?.isActive ? 'Active' : 'Inactive'}
              tone={partner?.isActive ? 'text-available-text' : 'text-muted'}
            />
          </dl>
        </Surface>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono,
  tone = 'text-ink',
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-[14px] text-muted">{label}</dt>
      <dd className={`text-[14px] font-medium ${tone} ${mono ? 'tabular' : ''}`}>{value}</dd>
    </div>
  );
}
