'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BonusCompositionBar, PageHeader, StatTile, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { dataStateOf } from '@/lib/queryState';
import { AccessRefused, LoadError } from '@/lib/components/DataStatus';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');
const amd = (v: string | number | undefined) => `${num(v)} ֏`;

export default function OverviewPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const { data: partner } = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => partnerApi.get(partnerId!),
    enabled: !!partnerId,
  });
  const analyticsQuery = useQuery({
    queryKey: ['partner-analytics', partnerId],
    queryFn: () => partnerApi.analytics(partnerId!),
    enabled: !!partnerId,
  });
  const analytics = analyticsQuery.data;
  const analyticsState = dataStateOf(analyticsQuery);

  /*
   * A figure, or a dash while there is none. This page is the first thing a
   * cashier sees after signing in, and a cashier may not read the business's
   * figures (ANALYTICS_READ): the request was refused and every tile said
   * "0 ֏", "0 transactions" — an unknown drawn as a closed-down shop.
   */
  const amdOrDash = (v: string | number | undefined) => (analytics ? amd(v) : '—');
  const numOrDash = (v: string | number | undefined) => (analytics ? num(v) : '—');

  const issued = Number(analytics?.totalBonusIssued ?? 0);
  const redeemed = Number(analytics?.totalBonusRedeemed ?? 0);
  const refused = analyticsState === 'forbidden';

  return (
    <>
      <PageHeader
        title={partner?.displayName ?? t('partnerPanel.overview.title')}
        description={t('partnerPanel.overview.description')}
      />

      {refused ? (
        <AccessRefused
          title={t('partnerPanel.refused.title')}
          message={t('partnerPanel.refused.overview')}
        />
      ) : null}
      {analyticsState === 'error' ? (
        <LoadError
          title={t('partnerPanel.overview.loadError')}
          onRetry={() => void analyticsQuery.refetch()}
          busy={analyticsQuery.isFetching}
        />
      ) : null}

      <div
        className={refused ? 'hidden' : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'}
      >
        {/* Net first, gross underneath it. A dashboard that led with gross
            reported a fully refunded sale as revenue and said nothing about
            refunds at all — so the headline number is what was actually
            sold, and the two figures it is made of are named next to it. */}
        <StatTile
          label={t('partnerPanel.overview.netRevenue')}
          value={amdOrDash(analytics?.netRevenue)}
          tone="brand"
          hint={t('partnerPanel.overview.netRevenueHint')}
        />
        <StatTile
          label={t('partnerPanel.overview.grossRevenue')}
          value={amdOrDash(analytics?.totalRevenue)}
        />
        <StatTile label={t('partnerPanel.overview.refunded')} value={amdOrDash(analytics?.totalRefunded)} />
        <StatTile
          label={t('partnerPanel.overview.transactions')}
          value={numOrDash(analytics?.totalTransactions)}
        />
        <StatTile
          label={t('partnerPanel.overview.uniqueCustomers')}
          value={numOrDash(analytics?.uniqueCustomers)}
        />
        <StatTile
          label={t('partnerPanel.overview.accrualRate')}
          value={partner ? `${(partner.bonusAccrualRateBps / 100).toFixed(2)}%` : '—'}
          hint={t('partnerPanel.overview.accrualRateHint')}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Issued vs redeemed is the number a partner actually cares about:
            what the loyalty programme costs versus what it brings back. */}
        <Surface className={refused ? 'hidden' : undefined}>
          <div className="text-[15px] font-semibold text-ink">
            {t('partnerPanel.overview.bonusFlow')}
          </div>
          <p className="mt-1 mb-5 text-[13px] text-muted">
            {t('partnerPanel.overview.bonusFlowHint')}
          </p>

          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] text-muted">{t('partnerPanel.overview.issued')}</span>
              <span className="tabular text-[19px] font-semibold text-available-text">
                {numOrDash(issued)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] text-muted">{t('partnerPanel.overview.redeemed')}</span>
              <span className="tabular text-[19px] font-semibold text-reserved-text">
                {numOrDash(redeemed)}
              </span>
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <BonusCompositionBar
              available={issued}
              pending={0}
              reserved={redeemed}
              labels={{
                available: t('partnerPanel.overview.issuedShort'),
                pending: '—',
                reserved: t('partnerPanel.overview.redeemedShort'),
              }}
              showLegend={false}
            />
            <p className="mt-3 text-[12px] text-faint">
              {t('partnerPanel.overview.redeemedNote')}
            </p>
          </div>
        </Surface>

        <Surface>
          <div className="text-[15px] font-semibold text-ink">
            {t('partnerPanel.overview.yourBusiness')}
          </div>
          <dl className="mt-5 space-y-4">
            <Row label={t('partnerPanel.overview.legalName')} value={partner?.legalName ?? '—'} />
            <Row
              label={t('partnerPanel.overview.category')}
              value={
                partner?.category
                  ? t(`partnerCategory.${partner.category}`, { defaultValue: partner.category })
                  : '—'
              }
            />
            <Row label={t('partnerPanel.overview.taxId')} value={partner?.taxId ?? '—'} mono />
            <Row
              label={t('partnerPanel.overview.statusLabel')}
              value={t(
                partner?.isActive ? 'partnerPanel.overview.active' : 'partnerPanel.overview.inactive',
              )}
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
