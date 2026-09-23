'use client';

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { transactionStatusKey, transactionTypeKey } from '@/lib/labels';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

const STATUS_TONE = {
  COMPLETED: 'available',
  PENDING: 'pending',
  INITIATED: 'pending',
  FAILED: 'danger',
  REVERSED: 'danger',
  FLAGGED: 'danger',
} as const;

export default function TransactionsPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const query = useQuery({
    queryKey: ['partner-transactions', partnerId],
    queryFn: () => partnerApi.transactions(partnerId!),
    enabled: !!partnerId,
  });
  const state = dataStateOf(query);
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('partnerPanel.transactions.title')}
        description={t('partnerPanel.transactions.description')}
      />

      {state === 'loading' ? (
        <LoadingNotice label={t('partnerPanel.transactions.loading')} />
      ) : state === 'error' ? (
        <LoadError
          title={t('partnerPanel.transactions.loadError')}
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('partnerPanel.transactions.emptyTitle')}
          message={t('partnerPanel.transactions.emptyMessage')}
        />
      ) : (
        <>
        {state === 'stale' ? (
          <StaleNotice
            asOf={query.dataUpdatedAt}
            what={t('partnerPanel.transactions.staleWhat')}
            onRetry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : null}
        <Table>
          <thead>
            <tr>
              <Th>{t('partnerPanel.transactions.colType')}</Th>
              <Th>{t('partnerPanel.transactions.colBranch')}</Th>
              <Th align="right">{t('partnerPanel.transactions.colAmount')}</Th>
              <Th align="right">{t('partnerPanel.transactions.colBonusApplied')}</Th>
              <Th align="right">{t('partnerPanel.transactions.colBonusEarned')}</Th>
              <Th>{t('partnerPanel.transactions.colStatus')}</Th>
              <Th align="right">{t('partnerPanel.transactions.colDate')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((tx) => (
              <Tr key={tx.id}>
                <Td>
                  <span className="text-ink">
                    {t(transactionTypeKey(tx.type), { defaultValue: tx.type })}
                  </span>
                </Td>
                {/* A dash, not an empty cell: a partner-wide QR, an EV session
                    and roaming all record no branch, and a blank here reads as
                    "we failed to load it" rather than "there is none". */}
                <Td>
                  {tx.branch ? (
                    <>
                      <span className="text-ink">{tx.branch.name}</span>
                      <span className="block text-[12px] text-muted">{tx.branch.address}</span>
                    </>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
                <Td align="right" className="tabular font-medium">
                  {num(tx.amount)} ֏
                </Td>
                <Td align="right" className="tabular">
                  {Number(tx.bonusAppliedAmount) > 0 ? (
                    <span className="text-reserved-text">−{num(tx.bonusAppliedAmount)}</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
                <Td align="right" className="tabular">
                  {Number(tx.bonusEarnedAmount) > 0 ? (
                    <span className="text-available-text">+{num(tx.bonusEarnedAmount)}</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[tx.status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                    {t(transactionStatusKey(tx.status), { defaultValue: tx.status })}
                  </Badge>
                </Td>
                <Td align="right" className="tabular text-[13px] text-muted">
                  {new Date(tx.createdAt).toLocaleString()}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        </>
      )}
    </>
  );
}
