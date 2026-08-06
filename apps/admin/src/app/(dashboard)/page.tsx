'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarList,
  BonusCompositionBar,
  PageHeader,
  StatTile,
  Surface,
} from '@tutak/design/web';
import { adminApi } from '@/lib/api/adminApi';
import { analyticsApi } from '@/lib/api/analyticsApi';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

export default function OverviewPage() {
  const { data: overview } = useQuery({ queryKey: ['admin-overview'], queryFn: adminApi.overview });
  const { data: platform } = useQuery({
    queryKey: ['platform-analytics'],
    queryFn: analyticsApi.platform,
  });

  return (
    <>
      <PageHeader title="Overview" description="Platform health at a glance." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Users" value={num(overview?.userCount)} />
        <StatTile label="Partners" value={num(overview?.partnerCount)} />
        <StatTile label="Transactions" value={num(overview?.transactionCount)} />
      </div>

      {/* Outstanding bonus liability, shown with the same three-state bar
          customers see for their own wallet. */}
      <Surface className="mt-4">
        <div className="mb-1 text-[15px] font-semibold text-ink">Outstanding bonus liability</div>
        <p className="mb-5 text-[13px] text-muted">
          Every bonus point currently held across all wallets, by state.
        </p>
        <BonusCompositionBar
          available={overview?.totalAvailableBonus ?? 0}
          pending={overview?.totalPendingBonus ?? 0}
          reserved={overview?.totalReservedBonus ?? 0}
        />
      </Surface>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface>
          <div className="mb-5 text-[15px] font-semibold text-ink">Transactions by type</div>
          {platform?.transactionsByType?.length ? (
            <BarList
              items={platform.transactionsByType.map((r) => ({
                label: r.type.replace(/_/g, ' ').toLowerCase(),
                value: r.count,
                hint: `${num(r.totalAmount)} ֏`,
              }))}
            />
          ) : (
            <p className="text-[14px] text-muted">No transactions yet.</p>
          )}
        </Surface>

        <Surface>
          <div className="mb-5 text-[15px] font-semibold text-ink">Lifetime bonus flow</div>
          <div className="space-y-4">
            <FlowRow label="Earned" value={num(platform?.bonusTotals.lifetimeEarned)} tone="text-available-text" />
            <FlowRow label="Spent" value={num(platform?.bonusTotals.lifetimeSpent)} tone="text-ink" />
            <FlowRow
              label="Currently available"
              value={num(platform?.bonusTotals.currentlyAvailable)}
              tone="text-brand"
            />
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <div className="mb-3 text-[13px] font-medium text-muted">By status</div>
            <div className="flex flex-wrap gap-2">
              {platform?.transactionsByStatus?.map((s) => (
                <span
                  key={s.status}
                  className="rounded-full bg-canvas px-3 py-1 text-[12px] text-muted"
                >
                  {s.status.toLowerCase()} · <span className="tabular text-ink">{s.count}</span>
                </span>
              ))}
            </div>
          </div>
        </Surface>
      </div>
    </>
  );
}

function FlowRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[14px] text-muted">{label}</span>
      <span className={`tabular text-[19px] font-semibold ${tone}`}>{value}</span>
    </div>
  );
}
