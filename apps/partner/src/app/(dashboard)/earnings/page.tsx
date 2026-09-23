'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
import { payoutStatusLabel } from '@/lib/labels';
import { dataStateOf } from '@/lib/queryState';
import { AccessRefused, LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_TONE = {
  REQUESTED: 'pending',
  PAID: 'available',
  FAILED: 'danger',
} as const;

/**
 * A partner's own money: what they are owed now, the real purchase activity
 * that built it up, and every transfer between them and TuTak in either
 * direction.
 *
 * Read-only by design — a partner cannot initiate their own payout or record
 * their own collection. The balance shown here is the same figure the
 * platform pays against, read from the same ledger account, so there is no
 * second number to disagree with.
 */
export default function EarningsPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const balanceQuery = useQuery({
    queryKey: ['partner-balance', partnerId],
    queryFn: () => financeApi.balance(partnerId!),
    enabled: !!partnerId,
  });
  // The legacy card-payment daily rollup. Empty for every partner running
  // only the live QR flow, since `CARD_PAYMENTS_ENABLED` stays off in
  // production — kept for the partners who do have real card activity,
  // rather than removed outright.
  const settlementsQuery = useQuery({
    queryKey: ['partner-settlements', partnerId],
    queryFn: () => financeApi.settlements(partnerId!),
    enabled: !!partnerId,
  });
  // The real source for a QR-only partner: confirmed PurchaseIntents,
  // grouped by day, straight from the ledger postings that built the
  // balance above.
  const activityQuery = useQuery({
    queryKey: ['partner-activity', partnerId],
    queryFn: () => financeApi.dailyActivity(partnerId!),
    enabled: !!partnerId,
  });
  const payoutsQuery = useQuery({
    queryKey: ['partner-payouts', partnerId],
    queryFn: () => financeApi.payouts(partnerId!),
    enabled: !!partnerId,
  });
  const collectionsQuery = useQuery({
    queryKey: ['partner-collections', partnerId],
    queryFn: () => financeApi.collections(partnerId!),
    enabled: !!partnerId,
  });

  const balance = balanceQuery.data;
  const balanceState = dataStateOf(balanceQuery);
  const settlementsState = dataStateOf(settlementsQuery);
  const activityState = dataStateOf(activityQuery);
  const payoutsState = dataStateOf(payoutsQuery);
  const collectionsState = dataStateOf(collectionsQuery);

  const days = settlementsQuery.data ?? [];
  const activityDays = activityQuery.data ?? [];
  const transfers = payoutsQuery.data ?? [];
  const collected = collectionsQuery.data ?? [];

  // Lifetime figures combine both pipelines, so a partner who moved between
  // them (or ran both at once) sees one true total rather than two partial
  // ones with no obvious relationship to each other. They are only a number
  // once both halves have answered: a sum over a list that never arrived is
  // not zero, it is unknown (U01).
  const lifetimeKnown = settlementsQuery.data !== undefined && activityQuery.data !== undefined;
  const lifetimeGross =
    days.reduce((acc, s) => acc + Number(s.grossAmount), 0) +
    activityDays.reduce((acc, d) => acc + Number(d.grossAmount), 0);
  const lifetimeCommission =
    days.reduce((acc, s) => acc + Number(s.commissionAmount), 0) +
    activityDays.reduce((acc, d) => acc + Number(d.commissionOwedAmount), 0);
  const lifetimeHint = lifetimeKnown
    ? undefined
    : settlementsState === 'error' || activityState === 'error'
      ? 'Could not load'
      : 'Loading…';
  const balanceHint =
    balanceState === 'error' ? 'Could not load' : balanceState === 'loading' ? 'Loading…' : undefined;

  if (!partnerId) {
    return (
      <EmptyState
        title="No partner linked"
        message="This account is not scoped to a partner, so there are no earnings to show."
      />
    );
  }

  // What TuTak owes the organisation is the owner's to read (the same rule as
  // the settlements screen). A cashier or manager used to get the figures;
  // now the API refuses them, and one plain sentence beats five red boxes.
  if (balanceState === 'forbidden') {
    return (
      <>
        <PageHeader
          title="Earnings"
          description="What you are owed, the purchase activity behind it, and every transfer between you and TuTak."
        />
        <AccessRefused
          title={t('partnerPanel.refused.title')}
          message={t('partnerPanel.refused.settlements')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Earnings"
        description="What you are owed, the purchase activity behind it, and every transfer between you and TuTak."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Available to pay out"
          value={balance ? `${money(balance.availableBalance)} AMD` : '—'}
          hint={balanceHint}
        />
        <StatTile
          label="Gross, lifetime"
          value={lifetimeKnown ? `${money(String(lifetimeGross))} AMD` : '—'}
          hint={lifetimeHint}
        />
        <StatTile
          label="Commission, lifetime"
          value={lifetimeKnown ? `${money(String(lifetimeCommission))} AMD` : '—'}
          hint={lifetimeHint}
        />
      </div>
      {balanceState === 'error' ? (
        <div className="mt-4">
          <LoadError
            title="Your balance could not be loaded"
            onRetry={() => void balanceQuery.refetch()}
            busy={balanceQuery.isFetching}
          />
        </div>
      ) : balanceState === 'stale' ? (
        <div className="mt-4">
          <StaleNotice
            asOf={balanceQuery.dataUpdatedAt}
            what="your balance"
            onRetry={() => void balanceQuery.refetch()}
            busy={balanceQuery.isFetching}
          />
        </div>
      ) : null}

      <h2 className="mt-8 text-[15px] font-semibold text-ink">QR purchase activity</h2>
      <div className="mt-3">
        {activityState === 'loading' ? (
          <LoadingNotice label="Loading purchase activity…" />
        ) : activityState === 'error' ? (
          <LoadError
            title="Purchase activity could not be loaded"
            onRetry={() => void activityQuery.refetch()}
            busy={activityQuery.isFetching}
          />
        ) : activityDays.length === 0 ? (
          <EmptyState
            title="No purchases yet"
            message="Confirmed QR purchases appear here the day they are confirmed."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Gross</Th>
                <Th align="right">Discount given</Th>
                <Th align="right">Commission owed</Th>
                <Th align="right">Net</Th>
                <Th align="right">Purchases</Th>
              </tr>
            </thead>
            <tbody>
              {activityDays.map((d) => (
                <Tr key={d.periodStart}>
                  <Td className="font-medium text-ink">{d.periodStart.slice(0, 10)}</Td>
                  <Td align="right" className="tabular">
                    {money(d.grossAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {money(d.discountGivenAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {money(d.commissionOwedAmount)}
                  </Td>
                  <Td align="right" className="tabular font-medium text-ink">
                    {money(d.netAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {d.purchaseCount}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {days.length > 0 && (
        <>
          <h2 className="mt-8 text-[15px] font-semibold text-ink">Daily settlements (card payments)</h2>
          <div className="mt-3">
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
          </div>
        </>
      )}

      <h2 className="mt-8 text-[15px] font-semibold text-ink">Payouts</h2>
      <div className="mt-3">
        {payoutsState === 'loading' ? (
          <LoadingNotice label="Loading payouts…" />
        ) : payoutsState === 'error' ? (
          <LoadError
            title="Payouts could not be loaded"
            onRetry={() => void payoutsQuery.refetch()}
            busy={payoutsQuery.isFetching}
          />
        ) : transfers.length === 0 ? (
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
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{payoutStatusLabel(p.status)}</Badge>
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

      <h2 className="mt-8 text-[15px] font-semibold text-ink">Collections</h2>
      <div className="mt-3">
        {collectionsState === 'loading' ? (
          <LoadingNotice label="Loading collections…" />
        ) : collectionsState === 'error' ? (
          <LoadError
            title="Collections could not be loaded"
            onRetry={() => void collectionsQuery.refetch()}
            busy={collectionsQuery.isFetching}
          />
        ) : collected.length === 0 ? (
          <EmptyState
            title="No collections yet"
            message="Transfers you send TuTak to settle a balance in their favour will be listed here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="right">Amount</Th>
                <Th>Reference</Th>
                <Th>Recorded</Th>
              </tr>
            </thead>
            <tbody>
              {collected.map((c) => (
                <Tr key={c.id}>
                  <Td align="right" className="tabular font-medium text-ink">
                    {money(c.amount)}
                  </Td>
                  <Td className="tabular text-[12px] text-muted">{c.bankReference}</Td>
                  <Td className="text-muted">{new Date(c.createdAt).toLocaleDateString()}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
