'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { financeApi } from '@/lib/api/financeApi';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_TONE = {
  REQUESTED: 'pending',
  PAID: 'available',
  FAILED: 'danger',
} as const;

/**
 * A partner's own money: what they are owed now, the daily settlements that
 * built it up, and what has been transferred out.
 *
 * Read-only by design — a partner cannot initiate their own payout. The
 * balance shown here is the same figure the platform pays against, read from
 * the same ledger account, so there is no second number to disagree with.
 */
export default function EarningsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const { data: balance } = useQuery({
    queryKey: ['partner-balance', partnerId],
    queryFn: () => financeApi.balance(partnerId!),
    enabled: !!partnerId,
  });
  const { data: settlements } = useQuery({
    queryKey: ['partner-settlements', partnerId],
    queryFn: () => financeApi.settlements(partnerId!),
    enabled: !!partnerId,
  });
  const { data: payouts } = useQuery({
    queryKey: ['partner-payouts', partnerId],
    queryFn: () => financeApi.payouts(partnerId!),
    enabled: !!partnerId,
  });

  const days = settlements ?? [];
  const transfers = payouts ?? [];
  const lifetimeGross = days.reduce((acc, s) => acc + Number(s.grossAmount), 0);
  const lifetimeCommission = days.reduce((acc, s) => acc + Number(s.commissionAmount), 0);

  if (!partnerId) {
    return (
      <EmptyState
        title="No partner linked"
        message="This account is not scoped to a partner, so there are no earnings to show."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Earnings"
        description="What you are owed, the daily settlements behind it, and transfers to your bank."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Available to pay out"
          value={balance ? `${money(balance.availableBalance)} AMD` : '—'}
        />
        <StatTile label="Settled, lifetime" value={`${money(String(lifetimeGross))} AMD`} />
        <StatTile label="Commission, lifetime" value={`${money(String(lifetimeCommission))} AMD`} />
      </div>

      <h2 className="mt-8 text-[15px] font-semibold text-ink">Daily settlements</h2>
      <div className="mt-3">
        {days.length === 0 ? (
          <EmptyState
            title="Nothing settled yet"
            message="Captured payments settle overnight and appear here the following day."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Gross</Th>
                <Th align="right">Commission</Th>
                <Th align="right">Net</Th>
                <Th align="right">Payments</Th>
                <Th align="right">Points issued</Th>
              </tr>
            </thead>
            <tbody>
              {days.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-medium text-ink">{s.periodStart.slice(0, 10)}</Td>
                  <Td align="right" className="tabular">
                    {money(s.grossAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {money(s.commissionAmount)}
                  </Td>
                  <Td align="right" className="tabular font-medium text-ink">
                    {money(s.netAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {s.paymentCount}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {money(s.bonusAccrued)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <h2 className="mt-8 text-[15px] font-semibold text-ink">Payouts</h2>
      <div className="mt-3">
        {transfers.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            message="Transfers to your bank account will be listed here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Reference</Th>
                <Th>Requested</Th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((p) => (
                <Tr key={p.id}>
                  <Td align="right" className="tabular font-medium text-ink">
                    {money(p.amount)}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="tabular text-[12px] text-muted">
                    {p.bankReference ?? p.failureReason ?? '—'}
                  </Td>
                  <Td className="text-muted">{new Date(p.createdAt).toLocaleDateString()}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
