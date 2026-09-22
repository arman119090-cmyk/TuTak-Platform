'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { transactionStatusLabel, transactionTypeLabel } from '@/lib/labels';
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
        title="Transactions"
        description="Every payment made at your business, newest first."
      />

      {state === 'loading' ? (
        <LoadingNotice label="Loading transactions…" />
      ) : state === 'error' ? (
        <LoadError
          title="Transactions could not be loaded"
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          message="Payments will appear here as soon as customers start paying with TuTak."
        />
      ) : (
        <>
        {state === 'stale' ? (
          <StaleNotice
            asOf={query.dataUpdatedAt}
            what="transactions"
            onRetry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : null}
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Branch</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Bonus applied</Th>
              <Th align="right">Bonus earned</Th>
              <Th>Status</Th>
              <Th align="right">Date</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((tx) => (
              <Tr key={tx.id}>
                <Td>
                  <span className="text-ink">{transactionTypeLabel(tx.type)}</span>
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
                    {transactionStatusLabel(tx.status)}
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
