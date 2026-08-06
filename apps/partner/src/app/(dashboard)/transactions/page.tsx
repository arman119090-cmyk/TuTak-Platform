'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';

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

  const { data } = useQuery({
    queryKey: ['partner-transactions', partnerId],
    queryFn: () => partnerApi.transactions(partnerId!),
    enabled: !!partnerId,
  });

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every payment made at your business, newest first."
      />

      {items.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          message="Payments will appear here as soon as customers start paying with TuTak."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
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
                  <span className="text-ink">{tx.type.replace(/_/g, ' ').toLowerCase()}</span>
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
                    {tx.status.toLowerCase()}
                  </Badge>
                </Td>
                <Td align="right" className="tabular text-[13px] text-muted">
                  {new Date(tx.createdAt).toLocaleString()}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
